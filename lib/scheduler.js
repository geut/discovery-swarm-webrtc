const { EventEmitter } = require('events')
const delay = require('delay')
const pForever = require('p-forever')

class Task extends EventEmitter {
  constructor (id, job, ms) {
    super()
    this._id = id
    this._job = task => job(task)
    this._ms = ms
    this._started = false
    this._destroyed = false
    this._delayedPromise = null
  }

  start () {
    if (this._started || this._destroyed) return
    let ms = this._ms

    pForever(async () => {
      try {
        if (this._destroyed) return pForever.end

        this._delayedPromise = delay(ms)

        await this._delayedPromise

        if (this._destroyed) return pForever.end

        const newMS = await this._job(this)

        if (Number.isInteger(newMS)) {
          ms = newMS
        } else {
          ms = this._ms
        }
      } catch (err) {
        console.warn(`Error in Task ${this._id}`, err.message)
      }
    }).finally(() => {
      this.emit('destroy')
    })

    this._started = true
  }

  destroy () {
    if (this._destroyed) return
    this._destroyed = true
    if (this._delayedPromise) this._delayedPromise.clear()
  }
}

class Scheduler {
  constructor () {
    this._tasks = new Map()
  }

  addTask (id, job, ms) {
    const task = new Task(id, job, ms)
    this._tasks.set(id, task)
    task.on('destroy', () => {
      if (this._tasks.has(id)) {
        this._tasks.delete(id)
      }
    })
    return task
  }

  startTask (id) {
    const task = this._tasks.get(id)
    if (task) {
      task.start()
    }
  }

  deleteTask (id) {
    const task = this._tasks.get(id)
    if (task) {
      task.destroy()
    }
  }

  clearTasks () {
    this._tasks.forEach(task => {
      task.destroy()
    })
  }
}

module.exports = Scheduler
