// Require the framework and instantiate it
import Fastify from 'fastify'
import * as dotenv from 'dotenv'
import { WebClient } from '@slack/web-api'
import crypto from 'crypto'

//
dotenv.config()

const fastify = Fastify({
  logger: true,
})

/**
 * route
 */
fastify.route({
  method: 'POST',
  url: '/watcher',

  handler: async (request, reply) => {
    let objResult = ''
    const undesireables = [
      '100.390.111', // Communication Error to Scheme Directory Server
      '000.400.030', // Transaction partially failed (please reverse manually due to failed automatic reversal)
      '900.100.100', // unexpected communication error with connector/acquirer
      '900.100.200', // error response from connector/acquirer
      '900.100.201', // error on the external gateway (e.g. on the part of the bank, acquirer,...)
      '900.100.202', // invalid transaction flow, the requested function is not applicable for the referenced transaction.
      '900.100.203', // error on the internal gateway
      '900.100.204', // Error during message parsing
      '900.100.300', // timeout, uncertain result
      '900.100.301', // Transaction timed out without response from connector/acquirer. It was reversed.
      '900.100.310', // Transaction timed out due to internal system misconfiguration. Request to acquirer has not been sent.
      '900.100.400', // timeout at connectors/acquirer side
      '900.100.500', // timeout at connectors/acquirer side (try later)
      '900.100.600', // connector/acquirer currently down
      '900.100.700', // error on the external service provider
      '900.200.100', // Message Sequence Number of Connector out of sync
      '900.300.600', // user session timeout
      '900.400.100', // unexpected communication error with external risk provider
      // '000.100.110', // Request successfully processed in 'Merchant in Integrator Test Mode'
    ]

    // attempt to decrypt data
    try {
      // Data from configuration
      const secretFromConfiguration = process.env.BIP_SECRET

      // Data from server
      const ivfromHttpHeader = request.headers['x-initialization-vector']
      const authTagFromHttpHeader = request.headers['x-authentication-tag']
      const httpBody = request.body

      // Convert data to process
      const key = new Buffer.from(secretFromConfiguration, 'hex')
      const iv = new Buffer.from(ivfromHttpHeader, 'hex')
      const authTag = new Buffer.from(authTagFromHttpHeader, 'hex')
      const cipherText = new Buffer.from(httpBody, 'hex')

      // Prepare decryption
      const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv)
      decipher.setAuthTag(authTag)

      // Decrypt, returns string
      const result = decipher.update(cipherText) + decipher.final()

      // parse to json
      objResult = JSON.parse(result)

      /**
       * throw server error when decryption fails
       */
    } catch (error) {
      reply.code(500)
      reply.send({ msg: 'Decryption failed' })

      throw new Error(error)
    }

    console.log(`Got result code: ${objResult.payload.result.code}`)

    // eval if code is an undesireable
    undesireables.forEach(async (undesireable) => {
      if (objResult.payload.result.code == undesireable) {
        console.log(`Undesireable result code detected: ${undesireable}`)

        // Initialize
        const slack = new WebClient(process.env.SLACK_BOT_TOKEN)

        // post data to channel
        try {
          const result = await slack.chat.postMessage({
            channel: process.env.SLACK_CHANNEL_ID,
            text: `:warning: *Detected Undesireable Result Code* :warning: \n\n*${objResult.payload.result.code}*\n${objResult.payload.result.description}\n\n*ID*\n${objResult.payload.id}\n\n*Entity ID*\n${objResult.payload.authentication.entityId}\n\n\nPlease check the entity for further investigation.`,
          })

          console.log(result)

          //
        } catch (error) {
          console.error(error)
        }
      }
    })
  },
})

// Run the server!
const start = async () => {
  try {
    // run on local mode
    if (process.env.SERVER_MODE === 'TEST') {
      await fastify.listen({ port: 3000 })
    } else {
      // use port provided by railway
      fastify.listen({
        host: '0.0.0.0',
        port: process.env.PORT,
      })
    }
  } catch (err) {
    fastify.log.error(err)
    process.exit(1)
  }
}

//
start()
