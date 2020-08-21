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

const callbackPromise = () => {
  let callback

  const promise = new Promise((resolve, reject) => {
    callback = (err, value) => {
      if (err) reject(err)
      else resolve(value)
    }
  })

  callback.promise = promise
  return callback
}

const resolveCallback = (promise, cb) => {
  if (!promise.then) {
    promise = Promise.resolve()
  }

  return promise.then(result => cb(null, result)).catch(cb)
}

module.exports = { toHex, toBuffer, callbackPromise, resolveCallback }
