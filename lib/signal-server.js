const SimpleSignalServer = require('simple-signal-server')

class SignalServer extends SimpleSignalServer {
  _onDiscover (socket, discoveryData) {
    const discoveryRequest = { socket, discoveryData }

    discoveryRequest.discover = (id = socket.id, discoveryData = {}) => {
      this._sockets[id] = socket
      socket.clientId = id

      socket.removeAllListeners('simple-signal[offer]')
      socket.removeAllListeners('simple-signal[signal]')
      socket.removeAllListeners('simple-signal[reject]')
      socket.removeAllListeners('simple-signal[candidates]')
      socket.removeAllListeners('simple-signal[leave]')
      socket.removeAllListeners('simple-signal[info]')

      socket.emit('simple-signal[discover]', { id, discoveryData })

      socket.on('simple-signal[offer]', this._onOffer.bind(this, socket))
      socket.on('simple-signal[signal]', this._onSignal.bind(this, socket))
      socket.on('simple-signal[reject]', this._onReject.bind(this, socket))
      socket.on('simple-signal[candidates]', (data, ack) => this._onTransaction(socket, 'candidates', data, ack))
      socket.on('simple-signal[leave]', (data, ack) => this._onTransaction(socket, 'leave', data, ack))
      socket.on('simple-signal[info]', data => this._onInfo(socket, data))
    }

    if (this.listeners('discover').length === 0) {
      discoveryRequest.discover() // defaults to using socket.id for identification
    } else {
      this.emit('discover', discoveryRequest)
    }
  }

  _onTransaction (socket, eventName, data, ack) {
    const transactionId = data.transactionId

    const request = {
      socket,
      discoveryData: data.discoveryData,
      forward: discoveryData => {
        ack({ transactionId, discoveryData })
      }
    }

    this.emit(eventName, request)
  }

  _onInfo (socket, data) {
    const request = {
      socket,
      discoveryData: data.discoveryData
    }

    this.emit('info', request)
  }
}

module.exports = SignalServer
