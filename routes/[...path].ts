import { sendResponseHeaderIfNotSet, autoDetectFormat, getStorageBucketFile, resize } from '../utils'
import { SourceConfig } from '../types'
import { sources } from '../config/sources.config'

export default defineEventHandler(async (event) => {
  try {
    let host = event.node.req.headers.host

    if (!host) {
      return createError({
        statusCode: 400,
        statusMessage: 'Illegal request'
      })
    }

    host = host.replace(/:\d+$/, '')

    const source: SourceConfig = sources[host]

    if (!source || source === null) {
      return createError({
        statusCode: 404,
        statusMessage: 'Config not found'
      })
    }

    if (!source['max-age']) {
      source['max-age'] = '3600'
    }

    if (!source['s-maxage']) {
      source['s-maxage'] = '3600'
    }

    sendResponseHeaderIfNotSet(
      event,
      "content-security-policy",
      "default-src 'none'",
    );

    const config = {
      accessKeyId: process.env[source.accessKeyId],
      secretAccessKey: process.env[source.secretAccessKey],
      bucket: process.env[source.bucket],
      region: process.env[source.region]
    }

    const path = event.path.replace(/^\//, '').replace(/\?.*/, '')
    const query = getQuery(event)
    const file = await getStorageBucketFile(config, path)

    // this is only available for ipx middleware - added here to experiment
    // keep an eye on what they do in ipx and update as necessary
    const mFormat = query.f || query.format;
    if (mFormat === "auto") {
      const acceptHeader = getRequestHeader(event, "accept") || "";
      const autoFormat = autoDetectFormat(
        acceptHeader,
        !!(query.a || query.animated),
      );
      delete query.f;
      delete query.format;
      if (autoFormat) {
        query.format = autoFormat;
        appendResponseHeader(event, "vary", "Accept");
      }
    }

    const resizedImage = await resize(file.data, query, path)

    // // Handle cache control
    const cacheControl = `max-age=${source['max-age']}, public, s-maxage=${source['s-maxage']}`
    setHeader(event, 'cache-control', cacheControl)

    // // Handle modified etag if available
    if (file.etag) {
      setHeader(event, 'etag', file.etag)
    }

    // // Handle modified time if available
    if (file.mtime) {
      setHeader(event, 'last-modified', file.mtime.toUTCString())
    }

    return resizedImage
  } catch (error) {
    if (error.message === 'The specified key does not exist.') {
      return createError({
        statusCode: 404,
        statusMessage: 'File not found'
      })
    }

    return createError({
      statusCode: 500,
      statusMessage: error.message
    })
  }
})
