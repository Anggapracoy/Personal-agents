from http.server import ThreadingHTTPServer,BaseHTTPRequestHandler
class H(BaseHTTPRequestHandler):
 def log_message(self,*args):pass
 def do_GET(self):
  if self.path=='/frame': body='<label>Frame note<input id="frame-note"></label>'
  else: body='''<!doctype html><title>Browser runtime comparison</title>
<label>Search products<input id="search" type="search"></label><output id="suggestion"></output>
<button id="continue" disabled>Continue</button><p id="result">Not continued</p>
<label>Notes<textarea id="notes"></textarea></label>
<iframe title="Details" src="http://127.0.0.1:8769/frame"></iframe>
<script>search.addEventListener('input',()=>{suggestion.textContent=search.value?'Match: '+search.value:'';document.getElementById('continue').disabled=true;setTimeout(()=>document.getElementById('continue').disabled=false,1000)});document.getElementById('continue').onclick=()=>document.getElementById('result').textContent='Continued';</script>'''
  self.send_response(200);self.send_header('Content-Type','text/html');self.end_headers();self.wfile.write(body.encode())
print('Comparison fixture http://localhost:8769',flush=True)
ThreadingHTTPServer(('127.0.0.1',8769),H).serve_forever()
