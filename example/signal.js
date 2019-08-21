const server = require('http').createServer()
const io = require('socket.io')(server)

const createSignal = require('../server')

function createServer ({ io }) {
  const signalSwarm = createSignal({ io })

  signalSwarm.on('info', (request) => {
    const { channel: channelName, peers = [] } = request.discoveryData
    const channel = signalSwarm.channels.get(channelName)
    const peerId = channel.get(request.socket.id)

    if (signalSwarm.channels.has(channelName)) {
      signalSwarm.channels.get(channelName).forEach((_peerId) => {
        if (peerId === _peerId) {
          return
        }

        // eslint-disable-next-line no-underscore-dangle
        const socket = signalSwarm._sockets[_peerId]
        if (socket) {
          socket.emit('simple-signal[info]', { channel: channelName, peerId, peers })
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
