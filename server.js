const debug = require('debug')('discovery-swarm-webrtc')

module.exports = function createServer ({ io }) {
  const signalServer = require('./lib/signal-server')(io)

  const channels = new Map()

  signalServer.on('discover', (request) => {
    const { id, channel: channelName } = request.discoveryData

    let channel = new Set()

    if (channels.has(channelName)) {
      channel = channels.get(channelName)
    } else {
      channels.set(channelName, channel)
    }

    channel.add(id)

    debug(`discover: ${id} channel: ${channelName}`)

    request.discover(id, { peers: Array.from(channel), channel: channelName })
  })

  signalServer.on('disconnect', (socket) => {
    const id = socket.clientId
    channels.forEach((channel, channelName) => {
      channel.forEach(peerId => {
        if (peerId === id) {
          debug(`disconnect: ${peerId} channel: ${channelName}`)
          channel.delete(peerId)
        }
      })
    })
  })

  signalServer.on('request', (request) => {
    debug(request.initiator, ' -> ', request.target)
    request.forward() // forward all requests to connect
  })

  return signalServer
}
