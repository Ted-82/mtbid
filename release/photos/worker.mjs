import repair from './repair.cjs';
export default {
 async scheduled(event,env){console.log(JSON.stringify(await repair.run(env,event.scheduledTime)));},
 async fetch(){return new Response(null,{status:404});}
};
