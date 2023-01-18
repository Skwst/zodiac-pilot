import React from 'react'
import { RiDeleteBinLine } from 'react-icons/ri'
import { encodeSingle, TransactionInput } from 'react-multisend'

import { IconButton } from '../../components'
import { ForkProvider } from '../../providers'
import { useConnection } from '../../settings'
import { useProvider } from '../ProvideProvider'
import { useDispatch, useNewTransactions } from '../state'

import { formatValue } from './formatValue'
import classes from './style.module.css'

type Props = {
  transaction: TransactionInput
  index: number
}

export const Remove: React.FC<Props> = ({ transaction, index }) => {
  const provider = useProvider()
  const dispatch = useDispatch()
  const transactions = useNewTransactions()
  const { connection } = useConnection()

  if (!(provider instanceof ForkProvider)) {
    // Removing transactions is only supported when using ForkProvider
    return null
  }

  const handleRemove = async () => {
    const laterTransactions = transactions.slice(index + 1)

    // remove the transaction and all later ones from the store
    dispatch({ type: 'REMOVE_TRANSACTION', payload: { id: transaction.id } })

    if (transactions.length === 1) {
      // no more recorded transaction remains: we can delete the fork and will create a fresh one once we receive the next transaction
      await provider.deleteFork()
      return
    }

    // revert to checkpoint before the transaction to remove
    const checkpoint = transaction.id // the ForkProvider uses checkpoints as IDs for the recorded transactions
    await provider.request({ method: 'evm_revert', params: [checkpoint] })

    // re-simulate all transactions after the removed one
    for (let i = 0; i < laterTransactions.length; i++) {
      const transaction = laterTransactions[i]
      const encoded = encodeSingle(transaction.input)
      await provider.request({
        method: 'eth_sendTransaction',
        params: [
          {
            to: encoded.to,
            data: encoded.data,
            value: formatValue(encoded.value),
            from: connection.avatarAddress,
          },
        ],
      })
    }
  }

  return (
    <IconButton
      onClick={handleRemove}
      className={classes.removeTransaction}
      title="Remove transaction"
    >
      <RiDeleteBinLine />
    </IconButton>
  )
}