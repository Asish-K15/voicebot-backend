import jwt from "jsonwebtoken";

// Optional authentication middleware:
// - If Authorization header exists and JWT is valid => req.user is set
// - If no token (guest) or invalid token => req.user = null
// - Never blocks the request
export default function optionalAuth(req, res, next) {
  const authHeader = req.header("Authorization");

  // No header => guest
  if (!authHeader) {
    req.user = null;
    return next();
  }

  const token = authHeader.startsWith("Bearer ")
    ? authHeader.replace("Bearer ", "")
    : authHeader;

  try {
    if (!token) {
      req.user = null;
      return next();
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded;
    return next();
  } catch (err) {
    // Invalid token => treat as guest
    req.user = null;
    return next();
  }
}

