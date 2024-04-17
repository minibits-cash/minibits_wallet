import {observer} from 'mobx-react-lite'
import React, {FC, useState, useEffect, useRef, useMemo} from 'react'
import {  
  TextStyle,
  ViewStyle,
  View,
  FlatList,
  SectionList,
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
  BottomModal,
} from '../components'
import {WalletStackScreenProps} from '../navigation'
import {useHeader} from '../utils/useHeader'
import {useStores} from '../models'
import {GroupedByTimeAgo, maxTransactionsInModel} from '../models/TransactionsStore'
import {Database, log} from '../services'
import AppError from '../utils/AppError'
import {TransactionListItem} from './Transactions/TransactionListItem'
import { Transaction, TransactionStatus } from '../models/Transaction'
import { height } from '@fortawesome/free-solid-svg-icons/faWallet'


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
      rightIcon: 'faEllipsisVertical',
      onRightPress: () => toggleDeleteModal()
    })

    const [showPendingOnly, setShowPendingOnly] = useState<boolean>(false)
    const [info, setInfo] = useState('')
    const [error, setError] = useState<AppError | undefined>()
    const [isLoading, setIsLoading] = useState(false)
    const [isHeaderVisible, setIsHeaderVisible] = useState(true)
    const [isDeleteModalVisible, setIsDeleteModalVisible] = useState(false)
    const [offset, setOffset] = useState<number>(transactionsStore.count) // load from db those that are not already displayed
    const [pendingOffset, setPendingOffset] = useState<number>(transactionsStore.pending.length) // load from db those that are not already displayed
    const [dbCount, setDbCount] = useState<number>(0)
    const [pendingDbCount, setPendingDbCount] = useState<number>(0)
    const [expiredDbCount, setExpiredDbCount] = useState<number>(0)
    const [erroredDbCount, setErroredDbCount] = useState<number>(0)
    const [isAll, setIsAll] = useState<boolean>(false)
    const [pendingIsAll, setPendingIsAll] = useState<boolean>(false)

    useEffect(() => {
        setIsLoading(true)
        const count = Database.getTransactionsCount() // all
        const pendingCount = Database.getTransactionsCount(TransactionStatus.PENDING)
        const expiredCount = Database.getTransactionsCount(TransactionStatus.EXPIRED)
        const erroredCount = Database.getTransactionsCount(TransactionStatus.ERROR)
        
        log.trace('transaction counts', {count, pendingCount})

        setDbCount(count)
        setPendingDbCount(pendingCount)
        setExpiredDbCount(expiredCount)
        setErroredDbCount(erroredCount)

        setIsLoading(false)

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
                transactionsStore.removeAllWithoutCurrentMint() // avoid that tx from deleted mints remain in model forever
            }            
        }
    }, [])

    const toggleDeleteModal = () => {
        setIsDeleteModalVisible(previousState => !previousState)
    }

    // TODO debug
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


    // TODO debug
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


    const onDeleteExpired = function () {
        try {
            toggleDeleteModal()
            setIsLoading(true)
            transactionsStore.deleteByStatus(TransactionStatus.EXPIRED)
            
            const count = Database.getTransactionsCount() // all            
            const expiredCount = Database.getTransactionsCount(TransactionStatus.EXPIRED)
    
            setDbCount(count)            
            setExpiredDbCount(expiredCount)            
            setIsLoading(false)
        } catch (e: any) {
            handleError(e)
        }        
    }


    const onDeleteErrored = function () {
        try {
            toggleDeleteModal()
            setIsLoading(true)
            transactionsStore.deleteByStatus(TransactionStatus.ERROR)
            
            const count = Database.getTransactionsCount() // all
            const erroredCount = Database.getTransactionsCount(TransactionStatus.ERROR)
    
            setDbCount(count)
            setErroredDbCount(erroredCount)
            setIsLoading(false)
        } catch (e: any) {
            handleError(e)
        }
    }

    const handleError = function (e: AppError): void {
        setIsLoading(false)
        setError(e)
    }

    const headerBg = useThemeColor('header')
    const iconColor = useThemeColor('textDim')    
    const activeIconColor = useThemeColor('button')
    const pendingBalance = proofsStore.getBalances().totalPendingBalance

    const sections = showPendingOnly ? Object.keys(transactionsStore.groupedPendingByTimeAgo).map((timeAgo) => ({
        title: timeAgo,
        data: transactionsStore.groupedPendingByTimeAgo[timeAgo],
    })) : Object.keys(transactionsStore.groupedByTimeAgo).map((timeAgo) => ({
        title: timeAgo,
        data: transactionsStore.groupedByTimeAgo[timeAgo],
    }))

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
                        text={'Pending balance'}
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
                        // bottomSeparator={true}
                        onPress={toggleShowPendingOnly}
                        />
                        <ListItem
                        text={showPendingOnly ? `Showing ${transactionsStore.pending.length} of ${pendingDbCount} pending` : `Showing ${transactionsStore.count} of ${dbCount} total`}
                        LeftComponent={
                            <Icon
                            containerStyle={$iconContainer}
                            icon="faListUl"
                            size={spacing.medium}
                            color={iconColor}
                            />
                        }
                        style={$item}
                        bottomSeparator={false}
                        onPress={() => false}
                        />
                    </>
                }
            />            
            <SectionList
                sections={sections}
                renderSectionHeader={({ section: { title, data } }) => (
                    <>
                        <Text size='xs' preset='formHelper' style={{ textAlign: 'center', color: iconColor}}>{title}</Text>
                        <Card
                            ContentComponent={
                                <>
                                {data.map((item, index) => (
                                    <TransactionListItem
                                        key={item.id}
                                        transaction={item as Transaction}
                                        isFirst={index === 0}
                                        isTimeAgoVisible={false}
                                        gotoTranDetail={gotoTranDetail}
                                        
                                    />
                                ))}
                                </>
                            }
                            style={$card}
                        />
                    </>
                )}
                renderItem={() => {return null}}
                ListFooterComponent={
                    <>
                    {sections.length > 0 && (
                        <View style={{alignItems: 'center', marginTop: spacing.small}}>
                            {!showPendingOnly && isAll || showPendingOnly && pendingIsAll ? (
                                <Text text="List is complete" size="xs" />
                            ) : (
                                <Button
                                    preset="secondary"
                                    onPress={getTransactionsList}
                                    text="View more"
                                    style={{minHeight: 25, paddingVertical: spacing.tiny}}
                                    textStyle={{fontSize: 14}}
                                />
                            )}
                        </View>
                    )}                    
                    </>
                }                        
                onScrollBeginDrag={collapseHeader}
                onStartReached={expandHeader}
                keyExtractor={(item, index) => String(item.id) as string}
                ListEmptyComponent={            
                    <Card
                        ContentComponent={
                            <ListItem
                                leftIcon='faBan'
                                text={"No transactions to show."}
                            />
                        }
                        style={$card}                
                    />
                }
                style={{maxHeight: spacing.screenHeight * 0.66}}                                
            />                                        
            {isLoading && <Loading />}
        </View>
        <BottomModal
          isVisible={isDeleteModalVisible ? true : false}
          style={{alignItems: 'stretch'}}            
          ContentComponent={
            <>
                <ListItem
                    text='Delete expired'
                    subText={`This will delete ${expiredDbCount} expired transactions`}
                    leftIcon='faRotate'
                    onPress={onDeleteExpired}
                    bottomSeparator={true}
                /> 
                <ListItem
                    text="Delete with errors"
                    subText={`This will delete ${erroredDbCount} transactions with errors`}
                    leftIcon='faBug'                            
                    onPress={onDeleteErrored}                                      
                />
            </> 
          }
          onBackButtonPress={toggleDeleteModal}
          onBackdropPress={toggleDeleteModal}
        />
        {error && <ErrorModal error={error} />}
        {info && <InfoModal message={info} />}
      </Screen>
    )
  },
)

const $screen: ViewStyle = {
    flex: 1,
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
  //minHeight: spacing.screenHeight * 0.5,
  //padding: spacing.extraSmall,
}

const $actionCard: ViewStyle = {
  margin: spacing.extraSmall,
  marginTop: -spacing.extraLarge * 2,  
  paddingTop: 0,
}

const $card: ViewStyle = {
  marginHorizontal: spacing.extraSmall,
  marginVertical: spacing.small,  
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

