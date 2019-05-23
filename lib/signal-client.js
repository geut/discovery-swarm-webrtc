const SimpleSignalClient = require('simple-signal-client')
const crypto = require('crypto')
const SimplePeer = require('simple-peer')

module.exports = class SignalClient extends SimpleSignalClient {
  constructor (socket, options = {}) {
    super(socket)

    this.transactions = new Map()

    this.options = options;

    ['candidates', 'leave', 'info'].forEach(event => {
      this.socket.on(`simple-signal[${event}]`, this._onTransaction.bind(this, event))
    })
  }

  async candidates (discoveryData = {}) {
    return this._emitTransaction('simple-signal[candidates]', discoveryData)
  }

  async leave (discoveryData = {}) {
    return this._emitTransaction('simple-signal[leave]', discoveryData)
  }

  async info (discoveryData = {}) {
    return this._emitTransaction('simple-signal[info]', discoveryData)
  }

  async _emitTransaction (event, discoveryData) {
    const transactionId = crypto.randomBytes(12).toString('hex')

    const promise = new Promise(resolve => {
      this.transactions.set(transactionId, resolve)
      this.socket.emit(event, { transactionId, discoveryData })
    })

    return promise
      .then(data => {
        this.transactions.delete(transactionId)
        return data
      })
      .catch(err => {
        this.transactions.delete(transactionId)
        throw err
      })
  }

  _onTransaction (event, data) {
    if (data.transactionId) {
      const resolve = this.transactions.get(data.transactionId)
      resolve(data.discoveryData)
    } else {
      this.emit(event, data)
    }
  }

  // Override connect and accept to provide delete sessionQueue on reject
  connect (target, metadata = {}, peerOptions = {}) {
    if (!this.id) throw new Error('Must complete discovery first.')

    peerOptions.initiator = true

    const sessionId = crypto.randomBytes(32).toString('hex')
    var firstOffer = true
    const peer = this._peers[sessionId] = new SimplePeer(peerOptions)

    peer.on('close', () => {
      peer.destroy()
      delete this._peers[sessionId]
    })

    peer.on('signal', (signal) => {
      const messageType = signal.sdp && firstOffer ? 'simple-signal[offer]' : 'simple-signal[signal]'
      if (signal.sdp) firstOffer = false
      this.socket.emit(messageType, {
        signal, metadata, sessionId, target
      })
    })

    return new Promise((resolve, reject) => {
      let timer

      peer.resolveMetadata = (metadata) => {
        if (timer) {
          clearTimeout(timer)
        }

        resolve({ peer, metadata })
      }

      peer.reject = (metadata) => {
        if (timer) {
          clearTimeout(timer)
        }

        delete this._peers[sessionId]
        peer.destroy()
        // eslint-disable-next-line
        reject({ metadata })
      }

      if (this.options.connectTimeout) {
        timer = setTimeout(() => {
          peer.reject({ reason: 'timeout' })
        }, this.options.connectTimeout)
      }
    })
  }
}
