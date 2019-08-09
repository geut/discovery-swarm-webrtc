const server = require('http').createServer()
const io = require('socket.io')(server)

const createSignal = require('../server')

function createServer ({ io }) {
  const signalSwarm = createSignal({ io })

  const connections = new Set()

  signalSwarm.on('peer:leave', ({ peerId }) => {
    connections.forEach((connection) => {
      if (connection.includes(peerId)) {
        connections.delete(connection)
      }
    })
  })

  signalSwarm.on('info', (request) => {
    const { type, channel: channelName, peers = [] } = request.discoveryData

    const connectionId = `${channelName}:${peers.sort().join(':')}`

    if (type === 'connection') {
      connections.add(connectionId)
    } else if (type === 'disconnection') {
      connections.delete(connectionId)
    }

    const result = Array.from(connections.values())
      .filter(connection => connection.includes(channelName))
      .map((connection) => {
        const conn = connection.split(':')
        return [conn[1], conn[2]]
      })

    if (signalSwarm.channels.has(channelName)) {
      signalSwarm.channels.get(channelName).forEach((peerId) => {
        // eslint-disable-next-line no-underscore-dangle
        const socket = signalSwarm._sockets[peerId]
        if (socket) {
          socket.emit('simple-signal[info]', { channel: channelName, connections: result })
        }
      })
    }

    request.forward()
  })
}

createServer({ io })

server.listen(4000, () => {
  console.log('discovery-signal-webrtc running on 4000')
})

process.on('unhandledRejection', function (err) {
  console.error('Unhandled rejection:', err.message)
})
