import {test} from 'node:test';import assert from 'node:assert/strict';import {createDocumentServer} from './server.mjs';
test('atomic revision comparison rejects concurrent stale writes and preserves exact source',async()=>{
 const server=createDocumentServer();await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const url=`http://127.0.0.1:${server.address().port}/documents/example`;
 try{
  const source='---\r\ntitle: exact\r\n---\r\n\r\nUnknown [[syntax]] 😀\r\n';
  const write=()=>fetch(url,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({baseRevision:'0',source})});
  const responses=await Promise.all([write(),write()]);assert.deepEqual(responses.map(r=>r.status).sort(),[200,409]);
  const reopened=await(await fetch(url)).json();assert.equal(reopened.source,source);assert.equal(reopened.revision,'1');
 }finally{await new Promise(resolve=>server.close(resolve));}
});
