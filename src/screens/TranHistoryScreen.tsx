import {observer} from 'mobx-react-lite'
import React, {FC, useState, useEffect, useRef, useMemo} from 'react'
import {
  ImageStyle,
  TextStyle,
  ViewStyle,
  View,
  ScrollView,
  Alert,
} from 'react-native'
import {formatDistance, toDate} from 'date-fns'
import {useThemeColor, spacing, colors, typography} from '../theme'
import {
  Button,
  Icon,
  Screen,
  Text,
  Card,
  ListItem,
  ErrorModal,
  InfoModal,
  Loading,
} from '../components'
import {WalletStackScreenProps} from '../navigation'
import {useHeader} from '../utils/useHeader'
import {useStores} from '../models'
import {maxTransactionsInModel} from '../models/TransactionsStore'
import {Database} from '../services'
import AppError from '../utils/AppError'
import {TransactionListItem} from './Transactions/TransactionListItem'

interface TranHistoryScreenProps
  extends WalletStackScreenProps<'TranHistory'> {}

// Number of transactions held in TransactionsStore model
const limit = maxTransactionsInModel

export const TranHistoryScreen: FC<TranHistoryScreenProps> = observer(function TranHistoryScreen(_props) {
    const {navigation} = _props
    const {transactionsStore, proofsStore} = useStores()
    useHeader({
      leftIcon: 'faArrowLeft',
      onLeftPress: () => navigation.goBack(),
    })

    const [showPendingOnly, setShowPendingOnly] = useState<boolean>(false)
    const [info, setInfo] = useState('')
    const [error, setError] = useState<AppError | undefined>()
    const [isLoading, setIsLoading] = useState(false)
    const [offset, setOffset] = useState<number>(transactionsStore.count) // load from db those that are not already displayed
    const [isAll, setIsAll] = useState<boolean>(false)

    useEffect(() => {
        if (transactionsStore.count < limit) {
            setIsAll(true)
        }
        // Run on component unmount (cleanup)
        return () => {
            /* When leaving screen we remove all transactions over numTransactionsInModel
            * from the transactionsStore that might have been sourced from sqlite db while browsing older records
            */
            transactionsStore.removeOldTransactions()
        }
    }, [])

    const getTransactionsList = async function () {
        setIsLoading(true)
        try {
            const result = await Database.getTransactionsAsync(limit, offset)

            if (result && result.length > 0) {
                // Add new transaction to the transactions store so mobx refreshes UI
                transactionsStore.addTransactionsToModel(result._array)

                setOffset(offset + result.length)

                if (result?.length < limit) {
                setIsAll(true)
                }
            }

            setIsLoading(false)
        } catch (e: any) {
            handleError(e)
        }
    }

    const toggleShowPendingOnly = function () {
        if (showPendingOnly) {
            setShowPendingOnly(false)
        } else {
            setShowPendingOnly(true)
        }
    }

    const gotoTranDetail = function (id: number) {
        navigation.navigate('TranDetail', {id})
    }

    const handleError = function (e: AppError): void {
        setIsLoading(false)
        setError(e)
    }

    const headerBg = useThemeColor('header')
    const iconColor = useThemeColor('textDim')
    const activeIconColor = useThemeColor('button')
    const pendingBalance = proofsStore.getBalances().totalPendingBalance

    return (
      <Screen style={$screen} preset="auto">
        <View style={[$headerContainer, {backgroundColor: headerBg}]}>
          <Text preset="heading" text="History" style={{color: 'white'}} />
        </View>
        <View style={$contentContainer}>
          <Card
            style={$actionCard}
            ContentComponent={
              <>
                <ListItem
                  text={'Pending'}
                  LeftComponent={
                    <Icon
                      containerStyle={$iconContainer}
                      icon="faPaperPlane"
                      size={spacing.medium}
                      color={showPendingOnly ? activeIconColor : iconColor}
                    />
                  }
                  RightComponent={
                    <Text style={$txAmount} text={`${pendingBalance}`} />
                  }
                  style={$item}
                  bottomSeparator={true}
                  onPress={toggleShowPendingOnly}
                />
                <ListItem
                  text="Filter by tags"
                  LeftComponent={
                    <Icon
                      containerStyle={$iconContainer}
                      icon="faTags"
                      size={spacing.medium}
                      color={iconColor}
                    />
                  }
                  style={$item}
                  bottomSeparator={false}
                  onPress={() => Alert.alert('Not implemented yet')}
                />
              </>
            }
          />
          {transactionsStore.count > 0 && (
            <Card
              ContentComponent={
                <>
                  {(showPendingOnly
                    ? transactionsStore.pending
                    : transactionsStore.all
                  ).map((tx, index: number) => (
                    <TransactionListItem
                      key={tx.id}
                      tx={tx}
                      gotoTranDetail={gotoTranDetail}
                      isFirst={index === 0}
                    />
                  ))}
                </>
              }
              FooterComponent={
                <View style={{alignItems: 'center'}}>
                  {isAll ? (
                    <Text text="List is complete" size="xs" />
                  ) : (
                    <Button
                      preset="tertiary"
                      onPress={getTransactionsList}
                      text="View more"
                      style={{minHeight: 25, paddingVertical: spacing.tiny}}
                      textStyle={{fontSize: 14}}
                    />
                  )}
                </View>
              }
              style={$card}
            />
          )}
          {isLoading && <Loading />}
        </View>
        {error && <ErrorModal error={error} />}
        {info && <InfoModal message={info} />}
      </Screen>
    )
  },
)

const $screen: ViewStyle = {
  // borderWidth: 1,
  // borderColor: 'red'
}

const $headerContainer: TextStyle = {
  alignItems: 'center',
  paddingBottom: spacing.medium,
  height: spacing.screenHeight * 0.18,
}

const $contentContainer: TextStyle = {
  minHeight: spacing.screenHeight * 0.5,
  padding: spacing.extraSmall,
}

const $actionCard: ViewStyle = {
  marginBottom: spacing.extraSmall,
  marginTop: -spacing.extraLarge * 2,
  paddingTop: 0,
}

const $card: ViewStyle = {
  marginBottom: spacing.small,
  paddingTop: 0,
}


const $iconContainer: ViewStyle = {
  padding: spacing.extraSmall,
  alignSelf: 'center',
  marginRight: spacing.medium,
}

const $item: ViewStyle = {
  marginHorizontal: spacing.micro,
}


const $txAmount: TextStyle = {
  fontFamily: typography.primary?.medium,
  alignSelf: 'center',
  marginRight: spacing.small,
}

