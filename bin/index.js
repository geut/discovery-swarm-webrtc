#!/usr/bin/env node

const server = require('http').createServer((_, res) => {
  res.statusCode = 200
  res.setHeader('Content-Type', 'text/plain')
  res.end('Signal running OK\n')
})
const io = require('socket.io')(server)

require('../server')({ io })
const argv = require('minimist')(process.argv.slice(2))

if (argv.help || argv.h) {
  console.log('discovery-signal-webrtc --port|-p 4000')
  process.exit(1)
}

const port = process.env.PORT || argv.port || argv.p || 4000

server.listen(port, () => {
  console.log('discovery-signal-webrtc running on %s', port)
})

process.on('unhandledRejection', function (err) {
  console.error('Unhandled rejection:', err.message)
})
