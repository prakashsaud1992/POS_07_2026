const jwt = require('jsonwebtoken')

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-me'

function createToken(user) {
  return jwt.sign(
    {
      userId: user.id,
      gmail: user.gmail,
      displayName: user.display_name,
      activeStoreId: user.activeStoreId || null,
      activeStoreCode: user.activeStoreCode || null,
      dataOwnerUserId: user.dataOwnerUserId || user.id,
      role: user.role || 'salesperson',
    },
    JWT_SECRET,
    { expiresIn: '7d' },
  )
}

function requireAuth(req, res, next) {
  const header = req.headers.authorization || ''
  const [, token] = header.split(' ')

  if (!token) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  try {
    const payload = jwt.verify(token, JWT_SECRET)
    req.auth = payload
    return next()
  } catch (error) {
    return res.status(401).json({ error: 'Invalid token' })
  }
}

module.exports = {
  createToken,
  requireAuth,
}
