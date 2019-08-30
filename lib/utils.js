const toHex = buff => {
  if (typeof buff === 'string') {
    return buff
  }

  if (Buffer.isBuffer(buff)) {
    return buff.toString('hex')
  }

  throw new Error('Cannot convert the buffer to hex: ', buff)
}

const toBuffer = str => {
  if (Buffer.isBuffer(str)) {
    return str
  }

  if (typeof str === 'string') {
    return Buffer.from(str, 'hex')
  }

  throw new Error('Cannot convert the string to buffer: ', str)
}

class SwarmError extends Error {
  constructor (message, code) {
    super(message)

    this.code = code || message
  }
}

const delay = ms => new Promise(resolve => setTimeout(resolve, ms))

module.exports = { toHex, toBuffer, SwarmError, delay }
