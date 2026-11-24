using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using System.Web.Script.Serialization;

namespace RexBidVault {
  public static class Core {
    public static readonly string[] Names = {"REXBID_AUTH_COOKIE_SECRET","REXBID_PORTAL_DATA_KEYS","REXBID_PORTAL_ACTIVE_KEY_ID","SUPABASE_URL","SUPABASE_PUBLISHABLE_KEY"};
    static readonly JavaScriptSerializer Json = new JavaScriptSerializer {MaxJsonLength=16384,RecursionLimit=8};
    static Exception Invalid() { return new InvalidOperationException("VAULT_VALIDATION_FAILED"); }
    // Flat string maps only; duplicates are rejected rather than overwritten.
    public static Dictionary<string,string> ParseMap(string source) {
      if(source==null || source.Length>16384) throw Invalid();
      int p=0; var result=new Dictionary<string,string>(StringComparer.Ordinal);
      Skip(source,ref p); if(p>=source.Length || source[p++]!='{') throw Invalid();
      Skip(source,ref p); if(p<source.Length && source[p]=='}') {p++; Skip(source,ref p); if(p!=source.Length) throw Invalid(); return result;}
      while(true) {
        string k=ReadString(source,ref p); Skip(source,ref p);
        if(p>=source.Length || source[p++]!=':') throw Invalid();
        string v=ReadString(source,ref p); if(result.ContainsKey(k)) throw Invalid(); result.Add(k,v);
        Skip(source,ref p); if(p>=source.Length) throw Invalid();
        char c=source[p++]; if(c=='}') break; if(c!=',') throw Invalid();
      }
      Skip(source,ref p); if(p!=source.Length) throw Invalid(); return result;
    }
    static void Skip(string s,ref int p) {while(p<s.Length && (s[p]==' '||s[p]=='\t'||s[p]=='\r'||s[p]=='\n')) p++;}
    static string ReadString(string s,ref int p) {
      Skip(s,ref p); int start=p; if(p>=s.Length || s[p++]!='"') throw Invalid();
      bool escaped=false;
      while(p<s.Length) {
        char c=s[p++]; if(c<32) throw Invalid();
        if(escaped) {escaped=false; continue;} if(c=='\\') {escaped=true; continue;}
        if(c=='"') { try {return Json.Deserialize<string>(s.Substring(start,p-start));} catch {throw Invalid();} }
      }
      throw Invalid();
    }
    public static string B64(byte[] bytes) {return Convert.ToBase64String(bytes).TrimEnd('=').Replace('+','-').Replace('/','_');}
    static byte[] DecodeKey(string value) {
      if(value==null || value.Length!=43 || !System.Text.RegularExpressions.Regex.IsMatch(value,"^[A-Za-z0-9_-]{43}$")) throw Invalid();
      byte[] raw; try {raw=Convert.FromBase64String(value.Replace('-','+').Replace('_','/')+"=");} catch {throw Invalid();}
      if(raw.Length!=32 || B64(raw)!=value) {Array.Clear(raw,0,raw.Length); throw Invalid();} return raw;
    }
    public static void Validate(Dictionary<string,string> v) {
      if(v==null || v.Count!=Names.Length) throw Invalid();
      foreach(var name in Names) if(!v.ContainsKey(name) || v[name]==null) throw Invalid();
      if(v[Names[0]].Length<43 || v[Names[0]].Length>1024 || v[Names[0]].IndexOfAny(new[]{'\r','\n','\0'})>=0) throw Invalid();
      if(v[Names[1]].Length>4096) throw Invalid();
      var ring=ParseMap(v[Names[1]]);
      if(ring.Count<1 || ring.Count>16 || !ring.ContainsKey(v[Names[2]])) throw Invalid();
      foreach(var entry in ring) {
        if(!System.Text.RegularExpressions.Regex.IsMatch(entry.Key,"^[A-Za-z0-9_-]{1,32}$")) throw Invalid();
        byte[] raw=DecodeKey(entry.Value); Array.Clear(raw,0,raw.Length);
      }
      if(v[Names[3]]!="https://kkwbqzndildovbblbkcx.supabase.co") throw Invalid();
      if(!System.Text.RegularExpressions.Regex.IsMatch(v[Names[4]],"^sb_publishable_[A-Za-z0-9_-]+$") || v[Names[4]].Length>4096) throw Invalid();
    }
    static string ProofValue(string name,string value) {
      if(name!=Names[1]) return value;
      var sorted=new SortedDictionary<string,string>(ParseMap(value),StringComparer.Ordinal);
      return Json.Serialize(sorted); // same full key set; insignificant JSON whitespace does not invalidate restore
    }
    public static string TransferValue(string name,string value) {return ProofValue(name,value);}
    static string Mac(string name,string value,string nonce) {
      byte[] key=Encoding.UTF8.GetBytes(ProofValue(name,value));
      byte[] message=Encoding.UTF8.GetBytes("rexbid-vault-proof:v1:"+nonce+":"+name);
      try {using(var hmac=new HMACSHA256(key)) return Convert.ToBase64String(hmac.ComputeHash(message));}
      finally {Array.Clear(key,0,key.Length);Array.Clear(message,0,message.Length);}
    }
    public static string CreateProof(Dictionary<string,string> values) {
      Validate(values); var proof=new Dictionary<string,string>(StringComparer.Ordinal);
      var nonce=new byte[32]; using(var rng=RandomNumberGenerator.Create()) rng.GetBytes(nonce);
      proof.Add("format","rexbid-vault-proof-v1"); proof.Add("nonce",Convert.ToBase64String(nonce));
      foreach(var name in Names) proof.Add(name,Mac(name,values[name],proof["nonce"]));
      Array.Clear(nonce,0,nonce.Length); return Json.Serialize(proof);
    }
    static bool Equal(string a,string b) {
      byte[] x,y; try {x=Convert.FromBase64String(a);y=Convert.FromBase64String(b);} catch {return false;}
      if(x.Length!=y.Length) return false; int difference=0;
      for(int i=0;i<x.Length;i++) difference|=x[i]^y[i]; return difference==0;
    }
    public static bool VerifyProof(Dictionary<string,string> values,string source) {
      try {
        Validate(values); var proof=ParseMap(source);
        if(proof.Count!=Names.Length+2 || proof["format"]!="rexbid-vault-proof-v1" || Convert.FromBase64String(proof["nonce"]).Length!=32) return false;
        foreach(var name in Names) if(!proof.ContainsKey(name) || !Equal(proof[name],Mac(name,values[name],proof["nonce"]))) return false;
        return true;
      } catch {return false;}
    }
    public static Dictionary<string,string> Fixture() {
      var a=new byte[32]; var b=new byte[32];for(int i=0;i<32;i++){a[i]=1;b[i]=2;}
      return new Dictionary<string,string> {{Names[0],B64(a)},{Names[1],"{\"fixture-old\":\""+B64(a)+"\",\"fixture-active\":\""+B64(b)+"\"}"},{Names[2],"fixture-active"},{Names[3],"https://kkwbqzndildovbblbkcx.supabase.co"},{Names[4],"sb_publishable_fixture_only_do_not_use"}};
    }
  }
  public interface IClipboardPort {bool Publish(IntPtr owner,string value);bool Clear(IntPtr owner);}
  public sealed class NativeClipboard : IClipboardPort {
    [DllImport("user32.dll",SetLastError=true)] static extern bool OpenClipboard(IntPtr owner);
    [DllImport("user32.dll")] static extern bool CloseClipboard();
    [DllImport("user32.dll")] static extern bool EmptyClipboard();
    [DllImport("user32.dll",CharSet=CharSet.Unicode)] static extern uint RegisterClipboardFormat(string name);
    [DllImport("user32.dll")] static extern IntPtr SetClipboardData(uint format,IntPtr value);
    [DllImport("kernel32.dll")] static extern IntPtr GlobalAlloc(uint flags,UIntPtr size);
    [DllImport("kernel32.dll")] static extern IntPtr GlobalLock(IntPtr value);
    [DllImport("kernel32.dll")] static extern bool GlobalUnlock(IntPtr value);
    [DllImport("kernel32.dll")] static extern IntPtr GlobalFree(IntPtr value);
    public static readonly string[] SuppressionFormats={"ExcludeClipboardContentFromMonitorProcessing","CanIncludeInClipboardHistory","CanUploadToCloudClipboard"};
    static bool Put(uint format,byte[] bytes) {
      IntPtr handle=GlobalAlloc(0x42,(UIntPtr)bytes.Length);if(handle==IntPtr.Zero)return false;
      IntPtr target=GlobalLock(handle);if(target==IntPtr.Zero){GlobalFree(handle);return false;}
      Marshal.Copy(bytes,0,target,bytes.Length);GlobalUnlock(handle);
      if(SetClipboardData(format,handle)==IntPtr.Zero){GlobalFree(handle);return false;}return true;
    }
    public bool Publish(IntPtr owner,string value) {
      if(owner==IntPtr.Zero || value==null)return false;
      uint[] formats=new uint[SuppressionFormats.Length];
      for(int i=0;i<formats.Length;i++){formats[i]=RegisterClipboardFormat(SuppressionFormats[i]);if(formats[i]==0)return false;}
      if(!OpenClipboard(owner))return false;
      byte[] text=null;
      try {
        if(!EmptyClipboard())return false;
        foreach(uint format in formats)if(!Put(format,new byte[4])){EmptyClipboard();return false;}
        text=Encoding.Unicode.GetBytes(value+"\0");
        if(!Put(13,text)){EmptyClipboard();return false;}return true;
      } finally {if(text!=null)Array.Clear(text,0,text.Length);CloseClipboard();}
    }
    public bool Clear(IntPtr owner) {if(owner==IntPtr.Zero || !OpenClipboard(owner))return false;try{return EmptyClipboard();}finally{CloseClipboard();}}
  }
  public sealed class TransferSession {
    readonly Dictionary<string,string> values;readonly IClipboardPort clipboard;
    DateTime expires; public bool Pending {get;private set;}
    public TransferSession(Dictionary<string,string> values,IClipboardPort clipboard) {Core.Validate(values);this.values=values;this.clipboard=clipboard;}
    public bool Copy(IntPtr owner,string name,DateTime now) {
      if(!values.ContainsKey(name))return false;Pending=true;expires=now.AddSeconds(45);
      if(clipboard.Publish(owner,Core.TransferValue(name,values[name])))return true;Clear(owner);return false;
    }
    public bool Clear(IntPtr owner) {if(!Pending)return true;if(!clipboard.Clear(owner))return false;Pending=false;return true;}
    public bool Tick(IntPtr owner,DateTime now) {if(Pending && now>=expires)return Clear(owner);return true;}
    public int Remaining(DateTime now) {return Pending?Math.Max(0,(int)Math.Ceiling((expires-now).TotalSeconds)):0;}
    public void Release() {values.Clear();}
  }
  public sealed class FakeClipboard : IClipboardPort {
    public int Publishes,Clears;public bool Busy,FailPublish;public string Text;
    public bool Publish(IntPtr owner,string value){Publishes++;if(FailPublish)return false;Text=value;return true;}
    public bool Clear(IntPtr owner){Clears++;if(Busy)return false;Text=null;return true;}
  }
  public static class Tests {
    public static string Run() {
      var names=new List<string>();var values=Core.Fixture();Core.Validate(values);names.Add("full_keyring_format");
      string proof=Core.CreateProof(values);if(!Core.VerifyProof(new Dictionary<string,string>(values),proof))throw new Exception("SELFTEST_FAILED");names.Add("portable_verifier_without_dpapi");
      var pretty=new Dictionary<string,string>(values);pretty[Core.Names[1]]=pretty[Core.Names[1]].Replace("{","{\r\n  ").Replace(",",",\r\n  ").Replace("}","\r\n}");
      string copiedRing=Core.TransferValue(Core.Names[1],pretty[Core.Names[1]]);pretty[Core.Names[1]]=copiedRing;
      if(copiedRing.IndexOfAny(new[]{'\r','\n'})>=0 || Core.ParseMap(copiedRing).Count!=2 || !Core.VerifyProof(pretty,proof))throw new Exception("SELFTEST_FAILED");names.Add("full_pretty_keyring_copied_single_line");
      var missing=new Dictionary<string,string>(values);missing[Core.Names[1]]="{\"fixture-active\":"+new JavaScriptSerializer().Serialize(Core.ParseMap(values[Core.Names[1]])["fixture-active"])+"}";
      if(Core.VerifyProof(missing,proof))throw new Exception("SELFTEST_FAILED");names.Add("full_keyring_truncation_rejected");
      var bad=new Dictionary<string,string>(values);bad[Core.Names[0]]=new string('x',43);if(Core.VerifyProof(bad,proof))throw new Exception("SELFTEST_FAILED");names.Add("wrong_cookie_secret_rejected");
      try{Core.ParseMap("{\"a\":\"one\",\"a\":\"two\"}");throw new Exception("SELFTEST_FAILED");}catch(InvalidOperationException){names.Add("duplicate_key_rejected");}
      bad=new Dictionary<string,string>(values);bad[Core.Names[2]]="missing";if(Core.VerifyProof(bad,proof))throw new Exception("SELFTEST_FAILED");names.Add("missing_active_key_rejected");
      bad=new Dictionary<string,string>(values);bad[Core.Names[3]]="https://ydfsuncohsntqwmtmnhe.supabase.co";if(Core.VerifyProof(bad,proof))throw new Exception("SELFTEST_FAILED");names.Add("staging_project_rejected");
      var clip=new FakeClipboard();var session=new TransferSession(values,clip);var now=DateTime.UtcNow;var owner=new IntPtr(1);
      if(clip.Publishes!=0 || !session.Copy(owner,Core.Names[0],now) || session.Remaining(now)!=45)throw new Exception("SELFTEST_FAILED");names.Add("explicit_copy_only");
      if(!session.Tick(owner,now.AddSeconds(46)) || clip.Text!=null || session.Pending)throw new Exception("SELFTEST_FAILED");names.Add("ttl_clears_clipboard");
      session.Copy(owner,Core.Names[0],now);clip.Busy=true;if(session.Clear(owner) || !session.Pending)throw new Exception("SELFTEST_FAILED");clip.Busy=false;if(!session.Clear(owner))throw new Exception("SELFTEST_FAILED");names.Add("busy_clipboard_not_reported_cleared");
      clip.FailPublish=true;if(session.Copy(owner,Core.Names[0],now) || clip.Text!=null)throw new Exception("SELFTEST_FAILED");names.Add("publication_failure_clears");
      session.Release();return new JavaScriptSerializer().Serialize(new {ok=true,checks=names,actual_clipboard_touched=false,real_secrets_used=false});
    }
  }
}
