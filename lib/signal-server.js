const SimpleSignalServer = require('simple-signal-server')

class SignalServer extends SimpleSignalServer {
  _onDiscover (socket, discoveryData) {
    const discoveryRequest = { socket, discoveryData }

    discoveryRequest.discover = (id = socket.id, discoveryData = {}) => {
      this._sockets[id] = socket
      socket.clientId = id

      socket.removeAllListeners('disconnect')
      socket.removeAllListeners('simple-signal[offer]')
      socket.removeAllListeners('simple-signal[signal]')
      socket.removeAllListeners('simple-signal[reject]')
      socket.removeAllListeners('simple-signal[candidates]')
      socket.removeAllListeners('simple-signal[leave]')

      socket.on('disconnect', this._onDisconnect.bind(this, socket))

      socket.emit('simple-signal[discover]', { id, discoveryData })

      socket.on('simple-signal[offer]', this._onOffer.bind(this, socket))
      socket.on('simple-signal[signal]', this._onSignal.bind(this, socket))
      socket.on('simple-signal[reject]', this._onReject.bind(this, socket))
      socket.on('simple-signal[candidates]', this._onCandidates.bind(this, socket))
      socket.on('simple-signal[leave]', this._onLeave.bind(this, socket))
    }

    if (this.listeners('discover').length === 0) {
      discoveryRequest.discover() // defaults to using socket.id for identification
    } else {
      this.emit('discover', discoveryRequest)
    }
  }

  _onCandidates (socket, data) {
    const transactionId = data.transactionId

    const request = {
      socket,
      discoveryData: data.discoveryData,
      forward: discoveryData => {
        socket.emit('simple-signal[candidates]', { transactionId, discoveryData })
      }
    }

    this.emit('candidates', request)
  }

  _onLeave (socket, data) {
    const transactionId = data.transactionId

    const request = {
      socket,
      discoveryData: data.discoveryData,
      forward: discoveryData => {
        socket.emit('simple-signal[leave]', { transactionId, discoveryData })
      }
    }

    this.emit('leave', request)
  }
}

module.exports = (...args) => new SignalServer(...args)
