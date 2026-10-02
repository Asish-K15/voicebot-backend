import jwt from "jsonwebtoken";

export default function auth(req, res, next) {
  const authHeader = req.header("Authorization");

  if (!authHeader) {
    return res.status(401).json({ message: "No token" });
  }

  const token = authHeader.startsWith("Bearer ")
    ? authHeader.replace("Bearer ", "")
    : authHeader;

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    req.user = decoded;
    next();
  } catch (err) {
    console.error("JWT ERROR:", err.message);
    return res.status(401).json({ message: "Invalid token" });
  }
}


