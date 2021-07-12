const delay = ms => {
  let cancel
  let finished = false
  const p = new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      finished = true
      resolve()
    }, ms)
    cancel = () => {
      if (finished) return
      clearTimeout(timer)
      reject(new Error('timeout'))
    }
  })
  p.cancel = cancel
  return p
}

class Task {
  constructor (fn) {
    this._fn = fn
    this._stop = false
    this.run()
  }

  run () {
    (async () => {
      while (!this._stop) {
        this._time = delay(Math.floor(Math.random() * 11) * 1000)
        await this._time
        if (this._stop) return
        await this._fn()
      }
    })().catch(() => {})
  }

  stop () {
    this._time && this._time.cancel()
    this._stop = true
  }
}

module.exports = class Scheduler {
  constructor () {
    this._tasks = new Map()
  }

  add (id, fn) {
    this._tasks.set(id, new Task(fn))
  }

  delete (id) {
    const task = this._tasks.get(id)
    task && task.stop()
    this._tasks.delete(id)
  }

  clear () {
    this._tasks.forEach(task => {
      task.stop()
    })
    this._tasks.clear()
  }
}
