import {observer} from 'mobx-react-lite'
import React, {FC, useState, useEffect, useRef, useMemo} from 'react'
import {
  ImageStyle,
  TextStyle,
  ViewStyle,
  View,
  ScrollView,
  Alert,
  FlatList,
  Platform,
  UIManager,
  LayoutAnimation,
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
import {Database, log} from '../services'
import AppError from '../utils/AppError'
import {TransactionListItem} from './Transactions/TransactionListItem'
import type { Transaction } from '../models/Transaction'


interface TranHistoryScreenProps
  extends WalletStackScreenProps<'TranHistory'> {}

if (Platform.OS === 'android' &&
    UIManager.setLayoutAnimationEnabledExperimental) {
    UIManager.setLayoutAnimationEnabledExperimental(true)
}
// Number of transactions held in TransactionsStore model
const limit = maxTransactionsInModel

export const TranHistoryScreen: FC<TranHistoryScreenProps> = observer(function TranHistoryScreen(_props) {
    const {navigation} = _props
    const {transactionsStore, proofsStore, mintsStore} = useStores()
    useHeader({
      leftIcon: 'faArrowLeft',
      onLeftPress: () => navigation.goBack(),
    })

    const [showPendingOnly, setShowPendingOnly] = useState<boolean>(false)
    const [info, setInfo] = useState('')
    const [error, setError] = useState<AppError | undefined>()
    const [isLoading, setIsLoading] = useState(false)
    const [isHeaderVisible, setIsHeaderVisible] = useState(true)
    const [offset, setOffset] = useState<number>(transactionsStore.count) // load from db those that are not already displayed
    const [pendingOffset, setPendingOffset] = useState<number>(transactionsStore.pending.length) // load from db those that are not already displayed
    const [dbCount, setDbCount] = useState<number>(0)
    const [pendingDbCount, setPendingDbCount] = useState<number>(0)
    const [isAll, setIsAll] = useState<boolean>(false)
    const [pendingIsAll, setPendingIsAll] = useState<boolean>(false)

    useEffect(() => {
        const count = Database.getTransactionsCount() // all
        const pendingCount = Database.getTransactionsCount(true) // pending only
        
        log.trace('transaction counts', {count, pendingCount})

        setDbCount(count)
        setPendingDbCount(pendingCount)

        if (count <= limit) {  
            log.trace('setAll true')          
            setIsAll(true)
        }

        if (pendingCount <= limit) {  
            log.trace('setPendingAll true')          
            setPendingIsAll(true)
        }
        // Run on component unmount (cleanup)
        return () => {
            /* When leaving screen we remove all transactions over maxTransactionsByMint
            * from the transactionsStore that might have been sourced from sqlite db while browsing older records
            */
            for (const mint of mintsStore.allMints) {
                transactionsStore.removeOldByMint(mint.mintUrl)
                //transactionsStore.removeOldTransactions()
            }            
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

                log.trace({storeCount: transactionsStore.count, dbCount})
                if (transactionsStore.count >= dbCount) {
                    log.trace('[getTransactionsList] setAll true')
                    setIsAll(true)
                }
            }

            setIsLoading(false)
        } catch (e: any) {
            handleError(e)
        }
    }



    const getPendingTransactionsList = async function () {
        setIsLoading(true)
        try {
            const result = await Database.getTransactionsAsync(limit, pendingOffset, true) // pending

            if (result && result.length > 0) {
                // Add new transaction to the transactions store so mobx refreshes UI
                transactionsStore.addTransactionsToModel(result._array)

                setOffset(pendingOffset + result.length)

                if (transactionsStore.pending.length === pendingDbCount) {
                    log.trace('[getTransactionsList] setAll true')
                    setPendingIsAll(true)
                }
            }

            setIsLoading(false)
        } catch (e: any) {
            handleError(e)
        }
    }

    const toggleShowPendingOnly = async function () {
        if (showPendingOnly) {            
            setShowPendingOnly(false)
        } else {
            await getPendingTransactionsList()
            setShowPendingOnly(true)
        }
    }

    const collapseHeader = function () {
        LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut)        
        setIsHeaderVisible(false)
        
    }

    const expandHeader = function () {
        LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut)
        setIsHeaderVisible(true)
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
      <Screen contentContainerStyle={$screen}>
        
            <View style={[isHeaderVisible ? $headerContainer : $headerCollapsed, {backgroundColor: headerBg}]}>
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
          {!showPendingOnly && transactionsStore.count > 0  && (
            <Card
              ContentComponent={
                <>
                    <FlatList<Transaction>
                        data={transactionsStore.all as Transaction[]}
                        renderItem={({ item, index }) => {                                
                            return(
                                <TransactionListItem
                                    key={item.id}
                                    tx={item as Transaction}
                                    gotoTranDetail={gotoTranDetail}
                                    isFirst={index === 0}
                                />
                            )
                        }}                        
                        ListFooterComponent={
                            <View style={{alignItems: 'center', marginTop: spacing.small}}>
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
                        extraData={transactionsStore.all}
                        onScrollBeginDrag={collapseHeader}
                        onStartReached={expandHeader}
                        keyExtractor={(item, index) => String(item.id) as string} 
                        style={{ maxHeight: spacing.screenHeight * 0.65 }}
                    />
                                      
                </>
              }
              style={$card}
            />
          )}

          {showPendingOnly && transactionsStore.count > 0  && (
            <Card
              ContentComponent={
                <>
                    <FlatList<Transaction>
                        data={transactionsStore.pending as Transaction[]}
                        renderItem={({ item, index }) => {                                
                            return(
                                <TransactionListItem
                                    key={item.id}
                                    tx={item as Transaction}
                                    gotoTranDetail={gotoTranDetail}
                                    isFirst={index === 0}
                                />
                            )
                        }}                        
                        ListFooterComponent={
                            <View style={{alignItems: 'center', marginTop: spacing.small}}>
                                {pendingIsAll ? (
                                    <Text text="List is complete" size="xs" />
                                ) : (
                                    <Button
                                        preset="tertiary"
                                        onPress={getPendingTransactionsList}
                                        text="View more"
                                        style={{minHeight: 25, paddingVertical: spacing.tiny}}
                                        textStyle={{fontSize: 14}}
                                    />
                                )}
                            </View>
                        }
                        extraData={transactionsStore.pending}
                        onScrollBeginDrag={collapseHeader}
                        onStartReached={expandHeader}
                        keyExtractor={(item, index) => String(item.id) as string} 
                        style={{ maxHeight: spacing.screenHeight * 0.65 }}
                    />
                                      
                </>
              }
              style={$card}
            />
          )}  
          
          {transactionsStore.count === 0 && (
            <Card
                ContentComponent={
                    <ListItem
                        subText={"No transactions to show."}
                    />
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
    flex: 1,
  // borderWidth: 1,
  // borderColor: 'red'
}

const $headerContainer: TextStyle = {
    alignItems: 'center',
    paddingBottom: spacing.medium,
    height: spacing.screenHeight * 0.18,
}

const $headerCollapsed: TextStyle = {
    alignItems: 'center',
    paddingBottom: spacing.medium,
    height: spacing.screenHeight * 0.07,
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

