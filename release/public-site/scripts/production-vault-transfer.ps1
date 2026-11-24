param(
  [ValidateSet('Transfer','VerifyVault','CheckSources','SelfTest','ClearClipboard')][string]$Mode='Transfer',
  [string]$ProofPath=''
)
$ErrorActionPreference='Stop'
$ProgressPreference='SilentlyContinue'
Set-StrictMode -Version 2
$oldPrivatePath='C:\Users\nowic\Documents\Codex\private-backups\rexbid\production-environment-20261006T182151Z'
$authPrivatePath='C:\Users\nowic\Documents\Codex\private-backups\rexbid\production-auth-20261007'
if(-not $ProofPath){
  $localProof=Join-Path $PSScriptRoot 'vault-verification-proof-v1.json'
  if($Mode-eq'VerifyVault'-and(Test-Path -LiteralPath $localProof)){$ProofPath=$localProof}
  else{$ProofPath=Join-Path $authPrivatePath 'vault-verification-proof-v1.json'}
}
function Initialize-Core {
  if(-not ('RexBidVault.Core' -as [type])) {
    Add-Type -AssemblyName System.Web.Extensions
    Add-Type -TypeDefinition ([IO.File]::ReadAllText((Join-Path $PSScriptRoot 'production-vault-core.cs'))) -ReferencedAssemblies System.Web.Extensions,System.Core
  }
}
function Test-ProtectedFolder([string]$directory) {
  if((Get-Item -LiteralPath $directory).Attributes-band[IO.FileAttributes]::ReparsePoint){throw 'VAULT_SOURCE_ACL_FAILED'}
  $acl=Get-Acl -LiteralPath $directory
  if(-not $acl.AreAccessRulesProtected){throw 'VAULT_SOURCE_ACL_FAILED'}
  $allowed=@([Security.Principal.WindowsIdentity]::GetCurrent().User.Value,'S-1-5-18')
  foreach($rule in $acl.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier])){
    if($rule.AccessControlType-eq[Security.AccessControl.AccessControlType]::Allow-and$rule.IdentityReference.Value-notin$allowed){throw 'VAULT_SOURCE_ACL_FAILED'}
  }
}
function Test-ProtectedFile([string]$source) {
  if((Get-Item -LiteralPath $source).Attributes-band[IO.FileAttributes]::ReparsePoint){throw 'VAULT_SOURCE_ACL_FAILED'}
  $acl=Get-Acl -LiteralPath $source
  $allowed=@([Security.Principal.WindowsIdentity]::GetCurrent().User.Value,'S-1-5-18')
  foreach($rule in $acl.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier])){
    if($rule.AccessControlType-eq[Security.AccessControl.AccessControlType]::Allow-and$rule.IdentityReference.Value-notin$allowed){throw 'VAULT_SOURCE_ACL_FAILED'}
  }
}
function Read-ProtectedMap([string]$source) {
  $bytes=$null;$plain=$null;$json=$null
  try {
    Test-ProtectedFile $source
    $bytes=[IO.File]::ReadAllBytes($source)
    if($bytes.Length-gt65536){throw 'VAULT_SOURCE_INVALID'}
    Add-Type -AssemblyName System.Security
    $plain=[Security.Cryptography.ProtectedData]::Unprotect($bytes,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser)
    $json=[Text.Encoding]::UTF8.GetString($plain)
    return ,([RexBidVault.Core]::ParseMap($json))
  } finally {
    if($plain){[Array]::Clear($plain,0,$plain.Length)}
    if($bytes){[Array]::Clear($bytes,0,$bytes.Length)}
    $json=$null
  }
}
function Get-ProductionValues {
  Test-ProtectedFolder $oldPrivatePath
  Test-ProtectedFolder $authPrivatePath
  Test-ProtectedFile (Join-Path $oldPrivatePath 'manifest.json')
  $manifest=[IO.File]::ReadAllText((Join-Path $oldPrivatePath 'manifest.json'))|ConvertFrom-Json
  if($manifest.new_keys.file-ne'new-production-keys-v1.json.dpapi'-or$manifest.new_keys.worker-ne'rexbid-production-preflight'){throw 'VAULT_WRONG_SOURCE'}
  $keyPath=Join-Path $oldPrivatePath $manifest.new_keys.file
  $cipherHash=(Get-FileHash -LiteralPath $keyPath -Algorithm SHA256).Hash.ToLowerInvariant()
  if($cipherHash-ne$manifest.new_keys.encrypted_sha256){throw 'VAULT_SOURCE_CHECKSUM_FAILED'}
  $keys=Read-ProtectedMap $keyPath
  $supabase=Read-ProtectedMap (Join-Path $authPrivatePath 'production-supabase.json.dpapi')
  if($keys.Count-ne3-or$supabase.Count-ne2){throw 'VAULT_SOURCE_INVALID'}
  $values=New-Object 'System.Collections.Generic.Dictionary[string,string]' ([StringComparer]::Ordinal)
  foreach($name in [RexBidVault.Core]::Names){
    if($keys.ContainsKey($name)){$values.Add($name,$keys[$name])}
    elseif($supabase.ContainsKey($name)){$values.Add($name,$supabase[$name])}
    else{throw 'VAULT_SOURCE_INCOMPLETE'}
  }
  if($values['REXBID_PORTAL_ACTIVE_KEY_ID']-ne$manifest.new_keys.active_key_id){throw 'VAULT_ACTIVE_ID_MISMATCH'}
  [RexBidVault.Core]::Validate($values)
  $keys.Clear();$supabase.Clear()
  return ,$values
}
function Get-IntegrityProof($values) {
  if(Test-Path -LiteralPath $ProofPath){
    $proof=[IO.File]::ReadAllText($ProofPath)
    if(-not[RexBidVault.Core]::VerifyProof($values,$proof)){throw 'VAULT_PROOF_MISMATCH'}
    return $proof
  }
  if([IO.Path]::GetDirectoryName([IO.Path]::GetFullPath($ProofPath))-ne$authPrivatePath){throw 'VAULT_PROOF_DESTINATION_NOT_PRIVATE'}
  $proof=[RexBidVault.Core]::CreateProof($values)
  # This receipt contains random nonce + keyed integrity checks, never values.
  [IO.File]::WriteAllText($ProofPath,$proof,[Text.UTF8Encoding]::new($false))
  return $proof
}
function Clear-WithRetry($port,[IntPtr]$owner) {
  for($attempt=0;$attempt-lt5;$attempt++){
    if($port.Clear($owner)){return $true}
    [Threading.Thread]::Sleep(40)
  }
  return $false
}
function Show-VaultForm($values,[string]$proof,[bool]$TestOnly=$false,[string]$FormMode=$Mode) {
  Add-Type -AssemblyName System.Windows.Forms,System.Drawing
  if([Threading.Thread]::CurrentThread.GetApartmentState()-ne'STA'){throw 'VAULT_STA_REQUIRED'}
  if($TestOnly){$port=New-Object RexBidVault.FakeClipboard}else{$port=New-Object RexBidVault.NativeClipboard}
  $form=New-Object Windows.Forms.Form
  $form.Text='REXBID — bezpieczne przekazanie do Bitwarden'
  $form.Size=New-Object Drawing.Size(830,540)
  $form.StartPosition='CenterScreen';$form.FormBorderStyle='FixedDialog';$form.MaximizeBox=$false
  $form.Font=New-Object Drawing.Font('Segoe UI',10)
  $info=New-Object Windows.Forms.Label
  $info.SetBounds(20,15,770,82);$info.Text='Nie pokazujemy wartości. Wklejaj wyłącznie do swojego Bitwarden. Wyłącz historię/synchronizację schowka Windows oraz zewnętrzne menedżery schowka. Nie używaj RDP, nagrywania ani udostępniania ekranu podczas transferu.'
  $form.Controls.Add($info)
  $status=New-Object Windows.Forms.Label;$status.SetBounds(20,377,770,55);$status.Text='Wartości pozostają w pamięci tego procesu. Brak sieci, logów i jawnego eksportu.';$form.Controls.Add($status)
  $finish=New-Object Windows.Forms.Button;$finish.SetBounds(570,440,218,40);$finish.Text='Wyczyść i zakończ';$form.Controls.Add($finish)
  $timer=New-Object Windows.Forms.Timer;$timer.Interval=500
  $state=@{Index=0;Session=$null;Confirm=$null;Name=$null;Copy=$null;Next=$null;Pasted=$false;Deadline=[DateTime]::MinValue;Inputs=@{};SuppressChange=$false}
  if($FormMode-eq'Transfer'){
    $state.Session=New-Object RexBidVault.TransferSession($values,$port)
    $consent=New-Object Windows.Forms.CheckBox;$consent.SetBounds(20,101,770,48);$consent.Text='Bitwarden jest odblokowany. Historia i synchronizacja schowka oraz menedżery schowka są wyłączone.';$form.Controls.Add($consent)
    $name=New-Object Windows.Forms.Label;$name.SetBounds(20,165,770,55);$name.Font=New-Object Drawing.Font('Segoe UI',13,[Drawing.FontStyle]::Bold);$form.Controls.Add($name);$state.Name=$name
    $instructions=New-Object Windows.Forms.Label;$instructions.SetBounds(20,225,770,70);$instructions.Text='Utwórz osobny wpis typu Login. Nazwa: REXBID production — nazwa pozycji powyżej. Username: nazwa pozycji. Password: wklej skopiowaną wartość. URI pozostaw puste. Cały keyring musi pozostać jedną wartością.';$form.Controls.Add($instructions)
    $copy=New-Object Windows.Forms.Button;$copy.SetBounds(20,300,275,42);$copy.Text='Kopiuj do schowka na 45 sekund';$copy.Enabled=$false;$form.Controls.Add($copy);$state.Copy=$copy
    $confirm=New-Object Windows.Forms.CheckBox;$confirm.SetBounds(320,300,460,42);$confirm.Text='Wkleiłem i zapisałem tę pozycję w Bitwarden';$confirm.Enabled=$false;$form.Controls.Add($confirm);$state.Confirm=$confirm
    $next=New-Object Windows.Forms.Button;$next.SetBounds(20,440,300,40);$next.Text='Wyczyść i przejdź dalej';$next.Enabled=$false;$form.Controls.Add($next);$state.Next=$next
    $update={ $state.Name.Text=('Pozycja '+($state.Index+1)+' / '+[RexBidVault.Core]::Names.Length+': '+[RexBidVault.Core]::Names[$state.Index]);$state.Confirm.Checked=$false;$state.Confirm.Enabled=$false;$state.Next.Enabled=$false }
    & $update
    $consent.Add_CheckedChanged({$state.Copy.Enabled=$consent.Checked})
    $confirm.Add_CheckedChanged({$state.Next.Enabled=$state.Confirm.Enabled-and$state.Confirm.Checked})
    $copy.Add_Click({
      try {
        if(-not$consent.Checked){return}
        if($state.Session.Copy($form.Handle,[RexBidVault.Core]::Names[$state.Index],[DateTime]::UtcNow)){$state.Confirm.Enabled=$true;$status.Text='Skopiowano. Wklej do pola Password w Bitwarden i zapisz. Schowek zostanie wyczyszczony po 45 sekundach.'}
        else{$status.Text='VAULT_CLIPBOARD_BUSY — kopiowanie nie powiodło się; zabezpieczenia nie zostały pominięte.'}
      } catch {[void](Clear-WithRetry $port $form.Handle);$status.Text='VAULT_COPY_FAILED — wartości nie są ujawniane. W razie blokady schowka nie zamykaj procesu siłowo.'}
    })
    $next.Add_Click({
      if(-not(Clear-WithRetry $port $form.Handle)){$status.Text='VAULT_CLIPBOARD_BUSY — schowek nie został jeszcze wyczyszczony. Zamknij aplikację blokującą schowek i ponów.';return}
      [void]$state.Session.Clear($form.Handle)
      if($state.Index-ge([RexBidVault.Core]::Names.Length-1)){$form.Close();return}
      $state.Index++;& $update;$status.Text='Schowek wyczyszczony. Następna pozycja jest gotowa do ręcznego skopiowania.'
    })
    $timer.Add_Tick({
      if($state.Session.Pending){
        if(-not$state.Session.Tick($form.Handle,[DateTime]::UtcNow)){$status.Text='VAULT_CLIPBOARD_BUSY — trwa ponawianie czyszczenia; nie zamykaj procesu siłowo.'}
        elseif(-not$state.Session.Pending){$status.Text='Schowek wyczyszczony po upływie czasu. Możesz ponownie skopiować bieżącą pozycję.'}
      }
    })
  } else {
    $info.Text='Weryfikacja offline wartości z Bitwarden, bez DPAPI i sieci. Wklej pięć pól Password. Wartości są maskowane. Wyłącz historię/synchronizację schowka oraz menedżery schowka. Bez RDP i udostępniania ekranu. Keyring wklej w całości, jako jedną linię JSON.'
    $y=105
    foreach($name in [RexBidVault.Core]::Names){
      $label=New-Object Windows.Forms.Label;$label.SetBounds(20,$y,350,28);$label.Text=$name;$form.Controls.Add($label)
      $input=New-Object Windows.Forms.TextBox;$input.SetBounds(380,$y,400,28);$input.UseSystemPasswordChar=$true;$form.Controls.Add($input);$state.Inputs[$name]=$input
      $input.Add_TextChanged({if(-not$state.SuppressChange){$state.Pasted=$true;$state.Deadline=[DateTime]::UtcNow.AddSeconds(30)}})
      $y+=49
    }
    $verify=New-Object Windows.Forms.Button;$verify.SetBounds(20,440,300,40);$verify.Text='Sprawdź i wyczyść schowek';$form.Controls.Add($verify)
    $verify.Add_Click({
      $entered=New-Object 'System.Collections.Generic.Dictionary[string,string]' ([StringComparer]::Ordinal)
      try {
        foreach($name in [RexBidVault.Core]::Names){$entered.Add($name,$state.Inputs[$name].Text)}
        if(-not(Clear-WithRetry $port $form.Handle)){$status.Text='VAULT_CLIPBOARD_BUSY — brak potwierdzenia wyczyszczenia; ponów kontrolę.';return}
        $state.Pasted=$false
        if([RexBidVault.Core]::VerifyProof($entered,$proof)){$status.Text='PASS — wszystkie pięć pozycji, pełny keyring oraz aktywny ID są zgodne z kontrolą źródłową. DPAPI nie było używane w tej weryfikacji.'}
        else{$status.Text='FAIL — co najmniej jedna pozycja jest niepełna lub niezgodna. Nie zmieniaj działających kluczy; sprawdź zapis w sejfie.'}
      } catch {$status.Text='VAULT_VERIFICATION_FAILED — wartości nie są ujawniane.'}
      finally {$entered.Clear();$state.SuppressChange=$true;foreach($box in $state.Inputs.Values){$box.Clear()};$state.SuppressChange=$false}
    })
    $timer.Add_Tick({if($state.Pasted-and[DateTime]::UtcNow-ge$state.Deadline){if(Clear-WithRetry $port $form.Handle){$state.Pasted=$false;$status.Text='Schowek wyczyszczony po 30 sekundach. Wklejone, maskowane pola nadal można sprawdzić.'}else{$status.Text='VAULT_CLIPBOARD_BUSY — czyszczenie będzie ponawiane.'}}})
  }
  $finish.Add_Click({$form.Close()})
  $onClose={param($sender,$eventArgs)
    $clear=$false
    $clear=Clear-WithRetry $port $form.Handle
    if(-not$clear){$eventArgs.Cancel=$true;$status.Text='VAULT_CLIPBOARD_BUSY — okno pozostaje otwarte do skutecznego wyczyszczenia schowka. Nie zabijaj procesu.'}
  }
  $form.Add_FormClosing($onClose)
  if($TestOnly){
    $testChecks=New-Object 'System.Collections.Generic.List[string]'
    $clickMethod=[Windows.Forms.Button].GetMethod('OnClick',[Reflection.BindingFlags]'Instance,NonPublic')
    try {
      if($FormMode-eq'Transfer'){
        if($state.Copy.Enabled-or$state.Next.Enabled-or$state.Confirm.Enabled-or$port.Publishes-ne0){throw 'SELFTEST_FAILED'}
        $state.Confirm.Checked=$true
        if($state.Next.Enabled){throw 'SELFTEST_FAILED'}
        $state.Confirm.Checked=$false;$testChecks.Add('cannot_skip_uncopied_position')
        $consent.Checked=$true
        [void]$clickMethod.Invoke($copy,@([EventArgs]::Empty))
        if($port.Publishes-ne1-or-not$state.Session.Pending){throw 'SELFTEST_FAILED'}
        $state.Confirm.Checked=$true
        if(-not$state.Next.Enabled){throw 'SELFTEST_FAILED'}
        [void]$clickMethod.Invoke($next,@([EventArgs]::Empty))
        if($state.Index-ne1-or$port.Text-or$state.Next.Enabled){throw 'SELFTEST_FAILED'}
        $testChecks.Add('transfer_gui_copy_save_next')
        $port.Text='synthetic-bitwarden-value-after-ttl'
        $eventArgs=New-Object Windows.Forms.FormClosingEventArgs([Windows.Forms.CloseReason]::UserClosing,$false)
        & $onClose $form $eventArgs
        if($eventArgs.Cancel-or$port.Text){throw 'SELFTEST_FAILED'}
        $testChecks.Add('finish_unconditionally_clears_clipboard')
        $port.Busy=$true
        $eventArgs=New-Object Windows.Forms.FormClosingEventArgs([Windows.Forms.CloseReason]::UserClosing,$false)
        & $onClose $form $eventArgs
        if(-not$eventArgs.Cancel){throw 'SELFTEST_FAILED'}
        $testChecks.Add('busy_clipboard_blocks_finish')
      } else {
        $fixture=[RexBidVault.Core]::Fixture()
        foreach($name in [RexBidVault.Core]::Names){
          if(-not$state.Inputs[$name].UseSystemPasswordChar){throw 'SELFTEST_FAILED'}
          $state.Inputs[$name].Text=$fixture[$name]
        }
        [void]$clickMethod.Invoke($verify,@([EventArgs]::Empty))
        if(-not$status.Text.StartsWith('PASS')-or$state.Pasted){throw 'SELFTEST_FAILED'}
        foreach($box in $state.Inputs.Values){if($box.Text){throw 'SELFTEST_FAILED'}}
        $fixture.Clear();$testChecks.Add('verify_gui_masked_off_device_and_clear')
      }
      return ,$testChecks.ToArray()
    } finally {
      $timer.Dispose();if($state.Session){$state.Session.Release()};$form.Dispose()
    }
  }
  $timer.Start()
  try {[void]$form.ShowDialog()}
  finally {
    $timer.Stop();$timer.Dispose()
    $cleared=Clear-WithRetry $port $form.Handle
    if($state.Session){$state.Session.Release()};foreach($box in $state.Inputs.Values){$box.Clear()};$form.Dispose()
    if(-not$cleared){[void][Windows.Forms.MessageBox]::Show('VAULT_CLIPBOARD_CLEAR_FAILED. Schowek blokuje inna aplikacja. Zamknij ją i uruchom production-vault-clear.cmd. Nie kopiuj kolejnego sekretu.','REXBID')}
  }
}
try {
  Initialize-Core
  if($Mode-eq'SelfTest'){
    $coreResult=[RexBidVault.Tests]::Run()|ConvertFrom-Json
    $fixture=[RexBidVault.Core]::Fixture();$fixtureProof=[RexBidVault.Core]::CreateProof($fixture)
    $transferChecks=Show-VaultForm $fixture $fixtureProof $true 'Transfer'
    $verifyChecks=Show-VaultForm $null $fixtureProof $true 'VerifyVault'
    @{ok=$true;checks=@($coreResult.checks)+@($transferChecks)+@($verifyChecks);actual_clipboard_touched=$false;real_secrets_used=$false}|ConvertTo-Json -Compress
    exit 0
  }
  if($Mode-eq'ClearClipboard'){
    Add-Type -AssemblyName System.Windows.Forms
    $clearForm=New-Object Windows.Forms.Form;$port=New-Object RexBidVault.NativeClipboard
    if(-not(Clear-WithRetry $port $clearForm.Handle)){throw 'VAULT_CLIPBOARD_BUSY'}
    $clearForm.Dispose();[void][Windows.Forms.MessageBox]::Show('Schowek został wyczyszczony.','REXBID');exit 0
  }
  if($Mode-eq'VerifyVault'){
    $proof=[IO.File]::ReadAllText($ProofPath)
    [void][RexBidVault.Core]::ParseMap($proof)
    Show-VaultForm $null $proof
  } else {
    $values=Get-ProductionValues
    $proof=Get-IntegrityProof $values
    if($Mode-eq'CheckSources'){
      $valid=[RexBidVault.Core]::VerifyProof($values,$proof)
      $names=@([RexBidVault.Core]::Names)
      $values.Clear()
      if(-not$valid){throw 'VAULT_PROOF_MISMATCH'}
      @{ok=$true;positions=$names;source_integrity='PASS';full_keyring='PASS';portable_verifier='LOCAL_PASS_WITHOUT_DPAPI';actual_bitwarden_saved=$false;actual_other_computer_verified=$false;clipboard_touched=$false;secret_values_printed=$false}|ConvertTo-Json -Depth 4
    } else {Show-VaultForm $values $proof}
  }
} catch {
  if($Mode-in@('CheckSources','SelfTest')){if($Mode-eq'SelfTest'){@{ok=$false;code='VAULT_SELFTEST_FAILED';type=$_.Exception.GetType().Name;stack=$_.ScriptStackTrace;secret_values_printed=$false}|ConvertTo-Json -Compress}else{Write-Output '{"ok":false,"code":"VAULT_OPERATION_FAILED","secret_values_printed":false}'}}
  else {Add-Type -AssemblyName System.Windows.Forms;[void][Windows.Forms.MessageBox]::Show('VAULT_OPERATION_FAILED. Transfer zatrzymany. Wartości nie zostały wyświetlone. Nie regeneruj kluczy; sprawdź instrukcję i dostęp do kopii.','REXBID')}
  exit 1
}
