import type {
  ErrorResponse,
  GetTxBySafeTxHashParams,
  GetBalanceParams,
  MethodToResponse,
  RequestId,
  SDKMessageEvent,
  RPCPayload,
  SendTransactionsParams,
  SignTypedMessageParams,
  SignMessageParams,
} from '@safe-global/safe-apps-sdk'
import { PermissionRequest } from '@safe-global/safe-apps-sdk/dist/types/types/permissions'
import {
  getSDKVersion,
  Methods,
  MessageFormatter,
} from '@safe-global/safe-apps-sdk'
import { ChainId } from 'ser-kit'
import {
  getBalances,
  getSafeInfo,
  SafeInfo,
  TransactionDetails,
} from '@safe-global/safe-gateway-typescript-sdk'
import { CHAIN_CURRENCY, CHAIN_NAME, CHAIN_PREFIX } from '../chains'
import { LegacyConnection, Eip1193Provider } from '../types'

import { getAddress } from 'ethers'

type MessageHandler = (
  params: any,
  id: SDKMessageEvent['data']['id'],
  env: SDKMessageEvent['data']['env']
) =>
  | void
  | MethodToResponse[Methods]
  | ErrorResponse
  | Promise<MethodToResponse[Methods] | ErrorResponse | void>

export const SAFE_APP_WHITELIST = [
  'https://app.stakewise.io',
  'https://app.uniswap.org',
  'https://snapshot.org',
  'https://testnet.snapshot.org',
  'https://swap.cow.fi',
  'https://www.drips.network',
  'https://app.balancer.fi',
  'https://stake.lido.fi',
  'https://curve.fi',
  'https://app.spark.fi',
  'https://community.safe.global',
  'https://app.nexusmutual.io',
  'https://v2.nexusmutual.io',
]

export default class SafeAppBridge {
  private provider: Eip1193Provider
  private connection: LegacyConnection
  private connectedOrigin: string | undefined
  private safeInfoPromise: Promise<SafeInfo>

  constructor(provider: Eip1193Provider, connection: LegacyConnection) {
    this.provider = provider
    this.connection = connection

    this.safeInfoPromise = getSafeInfo(
      CHAIN_PREFIX[this.connection.chainId],
      getAddress(this.connection.avatarAddress)
    )
  }

  setProvider = (provider: Eip1193Provider) => {
    this.provider = provider
  }

  setConnection = async (connection: LegacyConnection) => {
    const accountOrChainSwitched =
      connection.avatarAddress !== this.connection.avatarAddress ||
      connection.chainId !== this.connection.chainId

    this.safeInfoPromise = getSafeInfo(
      CHAIN_PREFIX[this.connection.chainId],
      getAddress(this.connection.avatarAddress)
    )

    this.connection = connection
    const href = await requestIframeHref()
    const currentOrigin = href && new URL(href).origin

    const isConnected =
      this.connectedOrigin && currentOrigin === this.connectedOrigin

    if (isConnected && accountOrChainSwitched) {
      // Safe Apps don't expect and won't support switching accounts or chains.
      // So we need to reload the iframe.

      this.connectedOrigin = undefined
      reloadIframe()
    }
  }

  handleMessage = async (msg: MessageEvent): Promise<void> => {
    if (
      !msg.source ||
      msg.source instanceof MessagePort ||
      msg.source instanceof ServiceWorker
    ) {
      // ignore messages from ports and workers
      return
    }

    if (msg.data.method === Methods.getSafeInfo) {
      // If we get here, it means the Safe App is connected
      if (msg.origin !== this.connectedOrigin) {
        console.debug('SAFE_APP_CONNECTED', msg.origin)
        this.connectedOrigin = msg.origin
      }
    }

    const handler = this.handlers[msg.data.method as Methods] as
      | MessageHandler
      | undefined
    if (!handler) return

    const logDetails = { data: msg.data, response: '⏳' } as any
    console.debug('SAFE_APP_MESSAGE', logDetails)
    try {
      const response = await handler(msg.data.params, msg.data.id, msg.data.env)
      if (typeof response !== 'undefined') {
        logDetails.response = response
        this.postResponse(msg.source, response, msg.data.id)
      } else {
        throw new Error('No response returned from handler')
      }
    } catch (e) {
      console.error(
        'Error handling message via SafeAppCommunicator',
        msg.data,
        e
      )
      this.postResponse(msg.source, getErrorMessage(e), msg.data.id, true)
    }
  }

  postResponse = (
    destination: Window,
    data: unknown,
    requestId: RequestId,
    error = false
  ): void => {
    const sdkVersion = getSDKVersion()
    const msg = error
      ? MessageFormatter.makeErrorResponse(
          requestId,
          data as string,
          sdkVersion
        )
      : MessageFormatter.makeResponse(requestId, data, sdkVersion)

    destination.postMessage(msg, '*')
  }

  handlers: { [method in Methods]: MessageHandler } = {
    [Methods.getTxBySafeTxHash]: ({ safeTxHash }: GetTxBySafeTxHashParams) => {
      // mock Safe Gateway's getTransactionDetails() response
      const safeAddress = getAddress(this.connection.avatarAddress)
      return {
        txHash: safeTxHash,
        safeAddress,
        txId: `multisig_${safeAddress}_${safeTxHash}`,
        executedAt: new Date().getTime(),
        txStatus: 'SUCCESS',
        // TODO we might have to retrieve the actual transaction details from reducer state
        txInfo: {
          type: 'Custom',
          to: {
            value: '0x0000000000000000000000000000000000000000',
          },
          dataSize: '0',
          value: '0',
          isCancellation: false,
        },
      } as TransactionDetails
    },

    [Methods.getEnvironmentInfo]: () => ({
      origin: document.location.origin,
    }),

    [Methods.getSafeInfo]: async () => {
      const info = await this.safeInfoPromise
      return {
        safeAddress: getAddress(this.connection.avatarAddress),
        chainId: this.connection.chainId,
        threshold: info.threshold,
        owners: info.owners.map((owner) => owner.value),
        isReadOnly: false,
        network:
          LEGACY_CHAIN_NAME[this.connection.chainId] ||
          CHAIN_NAME[this.connection.chainId].toUpperCase(),

        // below is an example response as set within Safe{Wallet}:
        // chainId: 1,
        // fallbackHandler: '0xf48f2B2d2a534e402487b3ee7C18c33Aec0Fe5e4',
        // guard: null,
        // implementation: '0xd9Db270c1B5E3Bd161E8c8503c55cEABeE709552',
        // isReadOnly: true,
        // modules: [
        //   '0x27d8bb2e33Bc38A9CE93fdD90C80677b8436aFfb',
        //   '0x1cFB0CD7B1111bf2054615C7C491a15C4A3303cc',
        //   '0x0DA0C3e52C977Ed3cBc641fF02DD271c3ED55aFe',
        // ],
        // network: 'MAINNET',
        // nonce: 2324,
        // owners: [
        //   '0x1B0C638616Ed79dB430Edbf549ad9512FF4a8ed1',
        //   '0x507A7777E6DbF4680951E63fB3753a20F2c37706',
        //   '0xa3a3456BC0c8ce4e0a0415B619803ee96509Ce30',
        //   '0xe9eB7DA58f6B5CE5b0a6cFD778A2fa726203AAD5',
        //   '0xFcf00B0fEdBc8f2F35a3B8d4B858d5805f2Bb05D',
        //   '0xE4Df0cdC9eF7e388eA906226010bBD1B9A6fFeD9',
        //   '0xD68f1A882f3F9ffddaBd4D30c4F8Dfca1f9e51Ba',
        //   '0xA1cf7F847eCD82459ce05a218EaA38a9D92E7b6b',
        //   '0x8fd960F1B9D68BAD2B97bD232FB75CC1f186B064',
        //   '0x5eD64f02588C8B75582f2f8eFd7A5521e3F897CC',
        //   '0x0DA0C3e52C977Ed3cBc641fF02DD271c3ED55aFe',
        // ],
        // safeAddress: '0x849D52316331967b6fF1198e5E32A0eB168D039d',
        // threshold: 3,
        // version: '1.3.0',
      }
    },

    [Methods.getSafeBalances]: ({ currency = 'usd' }: GetBalanceParams) => {
      return getBalances(
        CHAIN_PREFIX[this.connection.chainId],
        getAddress(this.connection.avatarAddress),
        currency,
        {
          exclude_spam: true,
          trusted: false, // TODO
        }
      )
    },

    [Methods.rpcCall]: async (params: RPCPayload) => {
      return await this.provider.request({
        method: params.call,
        params: params.params,
      })
    },

    [Methods.sendTransactions]: async ({ txs }: SendTransactionsParams) => {
      // hash would wrap in a multicall, but we want to record it unfolded
      const hashes = (await Promise.all(
        txs.map((tx) =>
          this.provider.request({ method: 'eth_sendTransaction', params: [tx] })
        )
      )) as string[]

      // return last transaction's hash
      return { safeTxHash: hashes[hashes.length - 1] }
    },

    [Methods.signMessage]: async ({ message }: SignMessageParams) => {
      // assume on-chain signature
      const safeTxHash = await this.provider.request({
        method: 'eth_sign',
        params: [message],
      })
      return { safeTxHash }
    },

    [Methods.signTypedMessage]: async ({
      typedData,
    }: SignTypedMessageParams) => {
      // assume on-chain signature
      const safeTxHash = await this.provider.request({
        method: 'eth_signTypedData_v4',
        params: [this.connection.avatarAddress, JSON.stringify(typedData)],
      })
      return { safeTxHash }
    },

    [Methods.getChainInfo]: () => {
      const { chainId } = this.connection
      return {
        chainName: CHAIN_NAME[chainId],
        chainId,
        shortName: CHAIN_PREFIX[chainId],
        nativeCurrency: CHAIN_CURRENCY[chainId],
        blockExplorerUriTemplate: {}, // TODO
      }
    },

    [Methods.wallet_getPermissions]: () => {
      return this.provider.request({ method: 'wallet_getPermissions' })
    },

    [Methods.wallet_requestPermissions]: (params: PermissionRequest[]) => {
      return this.provider.request({
        method: 'wallet_requestPermissions',
        params,
      })
    },

    // TODO see how to best implement the following methods
    [Methods.getOffChainSignature]: () => {
      return undefined
    },

    [Methods.requestAddressBook]: () => {
      return undefined
    },
  }
}

const getErrorMessage = (thrown: unknown) => {
  if (thrown instanceof Error) {
    return thrown.message
  }

  if (typeof thrown === 'string') {
    return thrown
  }

  try {
    return JSON.stringify(thrown)
  } catch {
    return String(thrown)
  }
}

const LEGACY_CHAIN_NAME: { [chainId in ChainId]?: string } = {
  1: 'MAINNET',
  100: 'XDAI',
}
