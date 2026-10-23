import http from 'node:http';
import app from '../index.mjs';
const port=Number(process.env.PORT||3000);
const server=http.createServer(async(req,res)=>{
  const chunks=[];let bytes=0;
  for await(const chunk of req){bytes+=chunk.length;if(bytes>100000){res.writeHead(413);res.end('Too large');return;}chunks.push(chunk);}
  const host=req.headers.host||'localhost:'+port;
  const url='http://'+host+req.url;
  const request=new Request(url,{method:req.method,headers:req.headers,body:['GET','HEAD'].includes(req.method)?undefined:Buffer.concat(chunks)});
  try{
    const response=await app.fetch(request);
    res.writeHead(response.status,Object.fromEntries(response.headers));
    res.end(Buffer.from(await response.arrayBuffer()));
  }catch(error){console.error(error);res.writeHead(500);res.end('Server error');}
});
server.listen(port,()=>console.log('AI Revenue Recovery listening on http://localhost:'+port));
