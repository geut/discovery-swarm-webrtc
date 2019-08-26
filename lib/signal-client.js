const crypto = require('crypto')
const SimpleSignalClient = require('simple-signal-client')
const io = require('socket.io-client')
const parseUrl = require('socket.io-client/lib/url')

const ERR_TRANSACTION_TIMEOUT = 'ERR_TRANSACTION_TIMEOUT'

class SignalError extends Error {
  constructor (message, code) {
    super(message)

    this.code = code || message
  }
}

class SignalClient extends SimpleSignalClient {
  static parseMetadataError (err) {
    if (err instanceof Error) {
      return err
    }

    if (!err.metadata || !err.metadata.code) {
      return new SignalError(JSON.stringify(err))
    }

    const { message, code } = err.metadata
    return new SignalError(message || code, code)
  }

  static createError (...args) {
    return new SignalError(...args)
  }

  constructor (options = {}) {
    const { bootstrap, transactionTimeout = 5 * 1000, ...opts } = options

    const urls = bootstrap.map(url => parseUrl(url).source)

    super(io(urls[0]), opts)

    this._urls = urls
    this._transactions = new Map()
    this._transactionTimeout = transactionTimeout

    this._initialize()
  }

  get connected () {
    return this.socket.connected
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

  _initialize () {
    ['candidates', 'leave', 'info'].forEach(event => {
      this.socket.on(`simple-signal[${event}]`, this._onTransaction.bind(this, event))
    })

    this.socket.on('connect', () => this.emit('connect'))

    this.socket.on('reconnect_error', error => {
      this.emit('reconnect-error', error)
      const lastUrl = this.socket.io.uri
      const lastIdx = this._urls.indexOf(lastUrl)
      const nextIdx = lastIdx === (this._urls.length - 1) ? 0 : lastIdx + 1
      this.socket.io.uri = this._urls[nextIdx]
    })
  }

  async _emitTransaction (event, discoveryData) {
    const transactionId = crypto.randomBytes(12).toString('hex')

    const promise = new Promise((resolve, reject) => {
      this._transactions.set(transactionId, { resolve, reject })
      this.socket.emit(event, { transactionId, discoveryData })
    })

    const timer = setTimeout(() => {
      if (this._transactions.has(transactionId)) {
        const { reject } = this._transactions.get(transactionId)
        reject(SignalClient.createError(ERR_TRANSACTION_TIMEOUT))
      }
    }, this._transactionTimeout)

    return promise
      .then(data => {
        clearTimeout(timer)
        this._transactions.delete(transactionId)
        return data
      })
      .catch(err => {
        clearTimeout(timer)
        this._transactions.delete(transactionId)
        throw err
      })
  }

  _onTransaction (event, data) {
    if (data.transactionId) {
      if (this._transactions.has(data.transactionId)) {
        const { resolve } = this._transactions.get(data.transactionId)
        resolve(data.discoveryData)
      }
    } else {
      this.emit(event, data)
    }
  }
}

module.exports = SignalClient
