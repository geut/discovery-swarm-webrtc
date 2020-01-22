const crypto = require('crypto')
const { EventEmitter } = require('events')
const SimpleSignalClient = require('simple-signal-client')
const io = require('socket.io-client')
const parseUrl = require('socket.io-client/lib/url')

const { SwarmError, toHex, toBuffer } = require('./utils')

const ERR_TRANSACTION_TIMEOUT = 'ERR_TRANSACTION_TIMEOUT'

class Request {
  constructor (simpleRequest) {
    this._simpleRequest = simpleRequest
  }

  get initiator () {
    return toBuffer(this._simpleRequest.initiator)
  }

  get channel () {
    return toBuffer(this._simpleRequest.metadata.channel)
  }

  get connectionId () {
    return toBuffer(this._simpleRequest.metadata.connectionId)
  }

  async accept (data, simplePeer) {
    try {
      const { peer: socket } = await this._simpleRequest.accept(data, simplePeer)
      return socket
    } catch (err) {
      throw SignalClient.parseMetadataError(err)
    }
  }

  async reject (data) {
    return this._simpleRequest.reject(data)
  }
}

class SignalClient extends EventEmitter {
  static parseMetadataError (err) {
    if (err instanceof Error) {
      return err
    }

    if (!err.metadata || !err.metadata.code) {
      return new SwarmError(JSON.stringify(err))
    }

    const { message, code } = err.metadata
    return new SwarmError(message || code, code)
  }

  constructor (options = {}) {
    super()

    const { bootstrap, requestTimeout, ...opts } = options

    this._urls = bootstrap.map(url => parseUrl(url).source)
    this._simpleSignal = new SimpleSignalClient(io(this._urls[0]), opts)
    this._transactions = new Map()
    this._requestTimeout = requestTimeout
    this._destroyed = false

    this._initialize()
  }

  get socket () {
    return this._simpleSignal.socket
  }

  get connected () {
    return this.socket.connected
  }

  async candidates (id, channel) {
    return this._emitTransaction('simple-signal[candidates]', { id: toHex(id), channel: toHex(channel) }, ({ peers = [] }) => {
      return peers.map(id => toBuffer(id))
    })
  }

  async leave (id, channel) {
    return this._emitTransaction('simple-signal[leave]', { id: toHex(id), channel: toHex(channel) })
  }

  info (discoveryData = {}) {
    return this.socket.emit('simple-signal[info]', { discoveryData })
  }

  discover (id, channel) {
    return this._simpleSignal.discover({ id: toHex(id), channel: toHex(channel) })
  }

  async connect (peer, simplePeer) {
    try {
      const { peer: socket } = await this._simpleSignal.connect(
        toHex(peer.id),
        { channel: toHex(peer.channel), connectionId: toHex(peer.connectionId) },
        simplePeer
      )
      return socket
    } catch (err) {
      throw SignalClient.parseMetadataError(err)
    }
  }

  async disconnect () {
    if (this._destroyed) return
    this._destroyed = true

    return new Promise(resolve => {
      if (this.socket.disconnected) {
        this._simpleSignal.destroy()
        resolve()
      }

      this.socket.once('disconnect', resolve)
      this._simpleSignal.destroy()
    })
  }

  _initialize () {
    this.socket.on('connect', () => this.emit('connect'))
    this.socket.on('connect_error', err => this.emit('error', new SwarmError(err.message, 'socket-connect-error', err.stack)))
    this.socket.on('connect_timeout', timeout => this.emit('error', new SwarmError(`connect-timeout ${timeout}`, 'socket-connect-timeout')))
    this.socket.on('error', err => this.emit('error', new SwarmError(err.message, 'socket-error', err.stack)))
    this.socket.on('reconnect_failed', () => this.emit('error', new SwarmError('socket-reconnect-failed')))

    this.socket.on('reconnect_error', err => {
      this.emit('error', new SwarmError(err.message, 'socket-reconnect-error', err.stack))
      const lastUrl = this.socket.io.uri
      const lastIdx = this._urls.indexOf(lastUrl)
      const nextIdx = lastIdx === (this._urls.length - 1) ? 0 : lastIdx + 1
      this.socket.io.uri = this._urls[nextIdx]
    })

    this._simpleSignal.on('discover', ({ channel, peers = [] }) => this.emit('discover', {
      channel: toBuffer(channel),
      peers: peers.map(id => toBuffer(id))
    }))

    this._simpleSignal.on('request', request => this.emit('request', new Request(request)))

    this.socket.on('simple-signal[info]', (data = {}) => this.emit('info', data))
  }

  async _emitTransaction (event, discoveryData, map = data => data) {
    const transactionId = crypto.randomBytes(12).toString('hex')

    const promise = new Promise((resolve, reject) => {
      this._transactions.set(transactionId, { resolve, reject })
      this.socket.emit(event, { transactionId, discoveryData }, data => {
        if (this._transactions.has(transactionId)) {
          resolve(data.discoveryData)
        }
      })
    })

    const timer = setTimeout(() => {
      if (this._transactions.has(transactionId)) {
        const { reject } = this._transactions.get(transactionId)
        reject(new SwarmError(`Timeout on event transaction: ${event}`, ERR_TRANSACTION_TIMEOUT))
      }
    }, this._requestTimeout)

    return promise
      .then(data => {
        clearTimeout(timer)
        this._transactions.delete(transactionId)
        return map(data)
      })
      .catch(err => {
        clearTimeout(timer)
        this._transactions.delete(transactionId)
        throw err
      })
  }
}

module.exports = SignalClient
