import { beforeEach,afterEach,describe,it,expect,vi } from 'vitest'
const fake=vi.hoisted(()=>({ranges:[] as Array<[number,number]>,records:[] as any[],session:{access_token:'synthetic-session'} as any,fetcher:vi.fn()}))
vi.mock('@supabase/supabase-js',()=>({createClient:()=>({
 auth:{getSession:async()=>({data:{session:fake.session}})},
 from:()=>({select:()=>{
   const query={eq:()=>query,order:()=>query,range:async(start:number,end:number)=>{
    fake.ranges.push([start,end]);return{data:fake.records.slice(start,end+1),error:null,count:fake.records.length}
   }};return query
 }}),
})}))
beforeEach(()=>{
 vi.resetModules();fake.ranges=[];fake.records=[];fake.session={access_token:'synthetic-session'};fake.fetcher.mockReset()
 vi.stubEnv('VITE_TEAM_SUPABASE_URL','https://example.supabase.co');vi.stubEnv('VITE_TEAM_SUPABASE_ANON_KEY','sb_publishable_synthetic_test_value');vi.stubGlobal('fetch',fake.fetcher)
})
afterEach(()=>{vi.unstubAllEnvs();vi.unstubAllGlobals()})
describe('browser team API',()=>{
 it('paginates histories beyond the default 1000-row platform limit',async()=>{
   fake.records=Array.from({length:1100},(_,id)=>({id}));const {rows}=await import('../../team/api')
   expect(await rows('ps_workspaces',q=>q.eq('owner_id','user').order('id'))).toHaveLength(1100)
   expect(fake.ranges).toEqual([[0,249],[250,499],[500,749],[750,999],[1000,1249]])
 })
 it('limits single analysis lookups without reading all historic analyses',async()=>{
   fake.records=Array.from({length:300},(_,id)=>({id}));const {rows}=await import('../../team/api')
   expect(await rows('ps_analyses',undefined,1)).toHaveLength(1);expect(fake.ranges).toEqual([[0,0]])
 })
 it('handles empty histories without another request',async()=>{
   const {rows}=await import('../../team/api');expect(await rows('ps_workspaces')).toEqual([]);expect(fake.ranges).toHaveLength(1)
 })
 it('only calls the authenticated studio function with an existing session',async()=>{
   const {call}=await import('../../team/api');fake.fetcher.mockResolvedValue(Response.json({ok:true}))
   await call('reference.extract',{requestId:'synthetic-request'})
   expect(fake.fetcher).toHaveBeenCalledTimes(1)
   const [url,init]=fake.fetcher.mock.calls[0];expect(url).toBe('https://example.supabase.co/functions/v1/prompt-studio-api')
   expect(init.headers.Authorization).toBe('Bearer synthetic-session');expect(JSON.parse(init.body).action).toBe('reference.extract')
 })
 it('does not automatically retry a failed paid operation',async()=>{
   const {call}=await import('../../team/api');fake.fetcher.mockResolvedValue(Response.json({error:'REQUEST_TIMEOUT'},{status:504}))
   await expect(call('reference.extract')).rejects.toThrow('REQUEST_TIMEOUT');expect(fake.fetcher).toHaveBeenCalledTimes(1)
 })
 it('requires sign-in before making a request',async()=>{
   fake.session=null;const {call}=await import('../../team/api');await expect(call('text.optimize')).rejects.toThrow('UNAUTHENTICATED');expect(fake.fetcher).not.toHaveBeenCalled()
 })
 it.each([new File(['svg'],'image.svg',{type:'image/svg+xml'}),new File([new Uint8Array(10*1024*1024+1)],'image.png',{type:'image/png'})])('rejects invalid reference input before upload',async file=>{
   const {uploadImage}=await import('../../team/api');await expect(uploadImage(file,'user')).rejects.toThrow('INVALID_IMAGE')
 })
})
