const http = require('http')
const net = require('net')

const TARGET_IP = '20.205.243.166'
const TARGET_PORT = 443
const LISTEN_PORT = 19443

const server = http.createServer((req, res) => {
  res.writeHead(405)
  res.end()
})

server.on('connect', (req, clientSocket, head) => {
  const upstream = net.connect(TARGET_PORT, TARGET_IP, () => {
    clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n')
    if (head.length) upstream.write(head)
    upstream.pipe(clientSocket)
    clientSocket.pipe(upstream)
  })
  upstream.on('error', () => clientSocket.destroy())
  clientSocket.on('error', () => upstream.destroy())
})

server.listen(LISTEN_PORT, '127.0.0.1', () => {
  console.log('connect proxy listening on ' + LISTEN_PORT)
})
