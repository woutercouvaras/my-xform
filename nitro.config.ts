//https://nitro.unjs.io/config
export default defineNitroConfig({
  routeRules: {
    '/**': {
      headers: {
        'access-control-allow-methods': 'GET',
        'cache-control': 'max-age=31536000, public, s-maxage=2592000',
        'content-security-policy': "default-src 'none'",
      }
    }
  }
})
