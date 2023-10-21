import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { Readable } from 'stream';
import { Stream } from 'stream';

import { negotiate } from "@fastify/accept-negotiator";
import type { SharpOptions } from "sharp";
import { imageMeta as getImageMeta, type ImageMeta } from "image-meta";

import type { Config as SVGOConfig } from "svgo";

import { HandlerName, applyHandler, getHandler } from './ipx/handlers';
import { cachedPromise } from "./ipx/utils";

import {
  getRequestHeader,
  setResponseHeader,
  setResponseStatus,
  createError,
  H3Event,
  appendResponseHeader,
  getResponseHeader,
} from "h3";

// import { config } from './config'

export const storageServices = {
  S3: 'S3',
  CLOUD_FLARE_R2: 'CLOUD_FLARE_R2'
}

export const sendResponseHeaderIfNotSet = (event: H3Event, name: string, value: any) => {
  if (!getResponseHeader(event, name)) {
    setResponseHeader(event, name, value);
  }
}

export const autoDetectFormat = (acceptHeader: string, animated: boolean) => {
  if (animated) {
    const acceptMime = negotiate(acceptHeader, ["image/webp", "image/gif"]);
    return acceptMime?.split("/")[1] || "gif";
  }
  const acceptMime = negotiate(acceptHeader, [
    "image/avif",
    "image/webp",
    "image/jpeg",
    "image/png",
    "image/tiff",
    "image/heif",
    "image/gif",
  ]);
  return acceptMime?.split("/")[1] || "jpeg";
}

export const getStorageBucketFile = async (config: any, path: string) => {
  try {
    const input = {
      Bucket: config.bucket,
      Key: path
    }

    config.credentials = {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey
    }

    const s3 = new S3Client(config)
    const command = new GetObjectCommand(input)
    const response = await s3.send(command)
      .then(data => data)
      .catch(error => {
        if (error?.$metadata?.httpStatusCode === 404) {
          Promise.reject('File not found')
        }
        throw error
      })

    if (!response || !response.Body) {
      throw new Error('File not found')
    }

    if (response?.$metadata?.httpStatusCode === 404) {
    } else if (response?.$metadata?.httpStatusCode !== 200) {
      throw new Error('Config error')
    }

    const readStream = response.Body as Readable

    return {
      data: readStream,
      etag: response.ETag,
      mtime: response.LastModified,
      contentType: response.ContentType,
      contentLength: response.ContentLength
    }
  } catch (error: any) {
    throw error
  }
}

export const resize = async (fileStream: Stream, modifiers: any = {}, filename: string) => {
  if (!modifiers || (modifiers && Object.keys(modifiers).length === 0)) {
    return fileStream
  }

  const file = await stream2Buffer(fileStream)

  const options: any = {}

  // https://sharp.pixelplumbing.com/#formats
  // (gif and svg are not supported as output)
  const SUPPORTED_FORMATS = new Set([
    "jpeg",
    "png",
    "webp",
    "avif",
    "tiff",
    "heif",
    "gif",
    "heic",
  ]);

  // Sharp loader
  const getSharp = cachedPromise(async () => {
    return (await import("sharp").then(
      (r) => r.default || r,
    )) as typeof import("sharp");
  });

  const getSVGO = cachedPromise(async () => {
    const { optimize } = await import("svgo");
    const { xss } = await import("./ipx/lib/svgo-xss");
    return { optimize, xss };
  });

  const process = cachedPromise(async () => {
    // const _sourceMeta = await getSourceMeta();
    const sourceData = file;

    // Detect source image meta
    let imageMeta: ImageMeta;
    try {
      imageMeta = getImageMeta(sourceData) as ImageMeta;
    } catch {
      throw createError({
        statusCode: 400,
        statusText: `IPX_INVALID_IMAGE`,
        message: `Cannot parse image metadata: ${filename}`,
      });
    }

    // Determine format
    let mFormat = modifiers.f || modifiers.format;
    if (mFormat === "jpg") {
      mFormat = "jpeg";
    }
    const format =
      mFormat && SUPPORTED_FORMATS.has(mFormat)
        ? mFormat
        : SUPPORTED_FORMATS.has(imageMeta.type || "") // eslint-disable-line unicorn/no-nested-ternary
        ? imageMeta.type
        : "jpeg";

    // Use original SVG if format is not specified
    if (imageMeta.type === "svg" && !mFormat) {
      if (options.svgo === false) {
        return {
          data: sourceData,
          format: "svg+xml",
          meta: imageMeta,
        };
      } else {
        // https://github.com/svg/svgo
        const { optimize, xss } = await getSVGO();
        const svg = optimize(sourceData.toString("utf8"), {
          ...options.svgo,
          plugins: [xss, ...(options.svgo?.plugins || [])],
        }).data;
        return {
          data: svg,
          format: "svg+xml",
          meta: imageMeta,
        };
      }
    }

    // Experimental animated support
    // https://github.com/lovell/sharp/issues/2275
    const animated =
      modifiers.animated !== undefined ||
      modifiers.a !== undefined ||
      format === "gif";

    const Sharp = await getSharp();
    let sharp = Sharp(sourceData, { animated, ...options.sharpOptions });
    Object.assign(
      (sharp as unknown as { options: SharpOptions }).options,
      options.sharpOptions,
    );

    // Resolve modifiers to handlers and sort
    const handlers = Object.entries(modifiers)
      .map(([name, arguments_]) => ({
        handler: getHandler(name as HandlerName),
        name,
        args: arguments_,
      }))
      .filter((h) => h.handler)
      .sort((a, b) => {
        const aKey = (a.handler.order || a.name || "").toString();
        const bKey = (b.handler.order || b.name || "").toString();
        return aKey.localeCompare(bKey);
      });

    // Apply handlers
    const handlerContext: any = { meta: imageMeta };
    for (const h of handlers) {
      sharp = applyHandler(handlerContext, sharp, h.handler, h.args) || sharp;
    }

    // Apply format
    if (SUPPORTED_FORMATS.has(format || "")) {
      sharp = sharp.toFormat(format as any, {
        quality: handlerContext.quality,
        progressive: format === "jpeg",
      });
    }

    // Convert to buffer
    const processedImage = await sharp.toBuffer();

    return {
      data: processedImage,
      format,
      meta: imageMeta,
    };
  });

  const { data } = await process();

  return data;
}

export const stream2Buffer = async (stream: Stream): Promise<Buffer> => {
  return new Promise <Buffer> ((resolve, reject) => {
      const _buf = Array <any> ()

      stream.on('data', chunk => _buf.push(chunk))
      stream.on('end', () => resolve(Buffer.concat(_buf)))
      stream.on('error', err => reject(`error converting stream - ${err}`))
  });
}
