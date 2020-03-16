const nanoerror = require('nanoerror')

function createError (code, message) {
  exports[code] = nanoerror(code, message)
}

createError('ERR_MAX_PEERS_REACHED', 'max peers reached: %s')
createError('ERR_INVALID_CHANNEL', 'invalid channel: %s')
createError('ERR_CONNECTION_DUPLICATED', 'connection duplicated: %s -> %s')
