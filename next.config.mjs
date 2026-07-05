/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Static export — emits a self-contained `out/` folder that Capacitor bundles
  // into the native app, and that Vercel serves as a static site. The app is
  // fully client-side (no server routes), so this is safe.
  output: "export",
  images: { unoptimized: true },
  trailingSlash: true,
};

export default nextConfig;
