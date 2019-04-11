const SimpleSignalClient = require('simple-signal-client')
const crypto = require('crypto')

module.exports = class SignalClient extends SimpleSignalClient {
  constructor (socket, events) {
    super(socket)

    this.events = events;
    this.transactions = new Map();

    ['candidates', 'leave', 'info'].forEach(event => {
      this.socket.on(`simple-signal[${event}]`, this._onTransaction.bind(this, event))
    })
  }

  async candidates (discoveryData = {}) {
    this.events && this.events.emit('signal.candidates');
    return this._emitTransaction('simple-signal[candidates]', discoveryData)
  }

  async leave (discoveryData = {}) {
    this.events && this.events.emit('signal.leave');
    return this._emitTransaction('simple-signal[leave]', discoveryData)
  }

  async info (discoveryData = {}) {
    this.events && this.events.emit('signal.info');
    return this._emitTransaction('simple-signal[info]', discoveryData)
  }

  async _emitTransaction (event, discoveryData) {
    const transactionId = crypto.randomBytes(12).toString('hex')
    return new Promise(resolve => {
      this.transactions.set(transactionId, resolve)
      this.socket.emit(event, { transactionId, discoveryData })
    })
  }

  _onTransaction (event, data) {
    if (data.transactionId) {
      const resolve = this.transactions.get(data.transactionId)
      this.transactions.delete(data.transactionId)
      resolve(data.discoveryData)
    } else {
      this.emit(event, data)
    }
  }
}
