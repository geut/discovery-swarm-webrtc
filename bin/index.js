#!/usr/bin/env node

const { SignalServer } = require('../server')

const server = require('http').createServer((_, res) => {
  res.statusCode = 200
  res.setHeader('Content-Type', 'text/plain')
  res.end('Signal running OK\n')
})

const signal = new SignalServer({ server, requestTimeout: 10 * 1000 })
signal.on('error', (err) => console.error('signal-error', err))
signal.on('connection-error', (err) => console.error('connection-error', err))
signal.on('rpc-error', (err) => console.error('rpc-error', err))

const argv = require('minimist')(process.argv.slice(2))

if (argv.help || argv.h) {
  console.log('discovery-swarm-webrtc --port|-p 4000')
  process.exit(1)
}

const port = process.env.PORT || argv.port || argv.p || 4000

server.listen(port, () => {
  console.log('discovery-swarm-webrtc running on %s', port)
})

process.on('unhandledRejection', function (err) {
  console.error('Unhandled rejection:', err.message)
})
