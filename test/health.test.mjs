import {test} from 'node:test';
import assert from 'node:assert/strict';
import {handleRequest} from '../server.mjs';

for(const method of ['GET','HEAD'])for(const cookie of ['', 'session=invalid'])test(`health ${method} works without authentication, cookie=${Boolean(cookie)}`,async()=>{
 const headers={};
 const res={setHeader(key,value){headers[key]=value;},writeHead(status,values){this.statusCode=status;Object.assign(headers,values);},end(body){this.body=body;}};
 await handleRequest({url:'/api/health',method,headers:{cookie}},res);
 assert.equal(res.statusCode,200);
 assert.equal(headers['Content-Type'],'application/json; charset=utf-8');
 assert.equal(headers['Cache-Control'],'no-store');
 assert.equal(headers['X-Robots-Tag'],'noindex, nofollow');
 if(method==='GET')assert.deepEqual(JSON.parse(res.body),{status:'ok'});
 else assert.equal(res.body,undefined);
});
