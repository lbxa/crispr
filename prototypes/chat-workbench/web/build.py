t=open('web/template.html').read()
e=open('web/engine.js').read().replace('</','<\\/')
open('web/index.html','w').write(t.replace('/*ENGINE*/',e))
