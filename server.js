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
      // Result codes for rejections due to communication errors
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

      // Result codes for rejections due to system errors
      '600.100.100', // Unexpected Integrator Error (Request could not be processed)
      '800.500.100', // direct debit transaction declined for unknown reason
      '800.500.110', // Unable to process transaction - ran out of terminalIds - please contact acquirer
      '800.600.100', // transaction is being already processed
      '800.800.400', // Connector/acquirer system is under maintenance
      '800.800.800', // The payment system is currenty unavailable, please contact support in case this happens again.
      '800.800.801', // The payment system is currenty unter maintenance. Please apologize for the inconvenience this may cause. If you were not informed of this maintenance window in advance, contact your sales representative.
      '999.999.888', // UNDEFINED PLATFORM DATABASE ERROR
      '999.999.999', // UNDEFINED CONNECTOR/ACQUIRER ERROR

      // for testing purposes
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
            text: `\n:warning: *Detected Undesireable Result Code* :warning: \n\n*${objResult.payload.result.code}*\n${objResult.payload.result.description}\n\n*ID*\n${objResult.payload.id}\n\n*Entity ID*\n${objResult.payload.authentication.entityId}\n\n`,
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
