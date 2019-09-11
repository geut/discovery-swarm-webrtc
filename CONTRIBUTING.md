# Contributing to discovery-swarm-webrtc

## Issue Contributions

When opening new issues or commenting on existing issues on this repository
please make sure discussions are related to concrete technical issues.

Try to be *friendly* (we are not animals :monkey: or bad people :rage4:) and explain correctly how we can reproduce your issue.

## Code Contributions

This document will guide you through the contribution process.

### Step 1: Fork

Fork the project [on GitHub](https://github.com/geut/discovery-swarm-webrtc) and check out your copy locally.

```bash
$ git clone git@github.com:username/discovery-swarm-webrtc.git
$ cd discovery-swarm-webrtc
$ npm install
$ git remote add upstream git://github.com/geut/discovery-swarm-webrtc.git
```

### Step 2: Branch

Create a feature branch and start hacking:

```bash
$ git checkout -b my-feature-branch -t origin/master
```

### Step 3: Test

Bug fixes and features **should come with tests**. We use [jest](https://jestjs.io/) to do that.

```bash
$ npm test
```

### Step 4: Lint

Make sure the linter is happy and that all tests pass. Please, do not submit
patches that fail either check.

We use [standard](https://standardjs.com/)

### Step 5: Commit

Make sure git knows your name and email address:

```bash
$ git config --global user.name "Bruce Wayne"
$ git config --global user.email "bruce@batman.com"
```

Writing good commit logs is important. A commit log should describe what
changed and why.

### Step 6: Changelog

If your changes are really important for the project probably the users want to know about it.

We use [chan](https://github.com/geut/chan/) to maintain a well readable changelog for our users.

### Step 7: Push

```bash
$ git push origin my-feature-branch
```

### Step 8: Make a pull request ;)
