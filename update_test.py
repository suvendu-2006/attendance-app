with open('test_registration.sh', 'r') as f:
    content = f.read()

content = content.replace('"password":"admin"', '"password":"demo"')
content = content.replace('-H "Content-Type: application/json" -d', '-H "Content-Type: application/json" -H "x-requested-with: api" -d')

with open('test_registration.sh', 'w') as f:
    f.write(content)
