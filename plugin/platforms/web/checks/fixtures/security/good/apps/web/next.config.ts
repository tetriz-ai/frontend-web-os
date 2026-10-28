export default { headers: async () => [{ source: '/:path*', headers: [{ key: 'Content-Security-Policy', value: "default-src 'self'" }] }] };
