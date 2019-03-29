const debug = require('debug')('discovery-swarm-webrtc')

module.exports = function createServer ({ io }) {
  const signalServer = require('./lib/signal-server')(io)

  const channels = new Map()

  signalServer.on('discover', (request) => {
    const { id } = request.socket
    const { id: peerId, channel: channelName } = request.discoveryData

    let channel = new Map()

    if (channels.has(channelName)) {
      channel = channels.get(channelName)
    } else {
      channels.set(channelName, channel)
    }

    channel.set(id, peerId)

    debug(`discover: ${peerId} channel: ${channelName}`)

    request.discover(peerId, { peers: Array.from(channel.values()), channel: channelName })
  })

  signalServer.on('disconnect', (socket) => {
    const { id } = socket
    channels.forEach((channel, channelName) => {
      const peerId = channel.get(id)
      if (peerId && channel.delete(id)) {
        debug(`disconnect: ${peerId} channel: ${channelName}`)
      }
    })
  })

  signalServer.on('request', (request) => {
    debug(request.initiator, ' -> ', request.target)
    request.forward() // forward all requests to connect
  })

  signalServer.on('candidates', request => {
    const { channel: channelName } = request.discoveryData

    const channel = channels.get(channelName) || new Map()

    return request.forward({ peers: Array.from(channel.values()), channel: channelName })
  })

  signalServer.on('leave', request => {
    const { id } = request.socket

    const { channel: channelName } = request.discoveryData

    if (!channels.has(channelName)) {
      return request.forward()
    }

    const channel = channels.get(channelName)

    const peerId = channel.get(id)
    if (peerId && channel.delete(id)) {
      debug(`leave: ${peerId} channel: ${channelName}`)
    }

    return request.forward()
  })

  return { signalServer, channels }
}
