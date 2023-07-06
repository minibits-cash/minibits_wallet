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
import {SettingsStackScreenProps} from '../navigation'
import {useHeader} from '../utils/useHeader'
import {log} from '../utils/logger'
import {Database} from '../services'
import AppError from '../utils/AppError'
import {BackupProof} from '../models/Proof'

interface LocalRecoveryScreenProps
  extends SettingsStackScreenProps<'LocalRecovery'> {}

// Number of transactions held in TransactionsStore model
const limit = 10

export const LocalRecoveryScreen: FC<LocalRecoveryScreenProps> =
  function LocalRecoveryScreen(_props) {

  const { navigation } = _props
  // const { proofsStore } = useStores()
  useHeader({
      leftIcon: 'faArrowLeft',
      onLeftPress: () => navigation.goBack(),
    })


  const [showPendingOnly, setShowPendingOnly] = useState<boolean>(false)
    const [showDeletedOnly, setShowDeletedOnly] = useState<boolean>(false)
    const [proofs, setProofs] = useState<BackupProof[]>([])
    const [selectedProofs, setSelectedProofs] = useState<BackupProof[]>([])
    const [info, setInfo] = useState('')
    const [error, setError] = useState<AppError | undefined>()
    const [isLoading, setIsLoading] = useState(false)
    const [offset, setOffset] = useState<number>(0) // load from db those that are not already displayed
    const [isAll, setIsAll] = useState<boolean>(false)

    useEffect(() => {
      getProofsList()
      // Run on component unmount (cleanup)
      return () => {}
    }, [])

    const getProofsList = function (
      isPending: boolean = false,
      isDeleted: boolean = false,
    ) {
      try {
        const proofs = Database.getProofs(limit, offset, isPending, isDeleted)

        if (proofs.length === 0) {
          setProofs([])
          setIsAll(true)
          setOffset(0)
        } else {
          if (proofs.length < limit) {
            setIsAll(true)
          }
          setProofs(proofs)
          setOffset(0)
        }
      } catch (e: any) {
        handleError(e)
      }
    }

    const getMore = function (
      isPending: boolean = false,
      isDeleted: boolean = false,
    ) {
      try {
        const proofs = Database.getProofs(limit, offset, isPending, isDeleted)

        if (proofs.length === 0) {
          setProofs([])
          setIsAll(true)
          setOffset(0)
        } else {
          if (proofs.length < limit) {
            setIsAll(true)
          }
          setProofs(prevProofs => [...prevProofs, ...proofs])
          setOffset(offset + proofs.length)
        }
      } catch (e: any) {
        handleError(e)
      }
    }

    const toggleShowPendingOnly = () =>
      setShowPendingOnly(previousState => {

    if (previousState) {
          getProofsList()
        } else {
          getProofsList(true, false)
        }

        setShowDeletedOnly(false)
        return !previousState
      })

    const toggleShowDeletedOnly = async () =>
      setShowDeletedOnly(previousState => {
        if (previousState) {
          getProofsList()
        } else {
          getProofsList(false, true)
        }

        setShowPendingOnly(false)
        return !previousState
      })

    const toggleSelectedProof = function (proof: BackupProof) {
      setSelectedProofs(prevSelectedProofs => {
        const isSelected = prevSelectedProofs.some(
          p => p.secret === proof.secret
        )

        if (isSelected) {
          // If the proof is already selected, remove it from the array
          return prevSelectedProofs.filter(p => p.secret !== proof.secret)
        } else {
          // If the proof is not selected, add it to the array
          return [...prevSelectedProofs, proof]
        }
      })
    }

    /*type ProofGroup = {
    [date: string]: BackupProof[]
  }


  const proofGroups = proofs.reduce((groups: ProofGroup, proof: BackupProof) => {
    const date = new Date(proof.updatedAt).toLocaleString() // Get the date part of updatedAt as a string

    if (!groups[date]) {
      groups[date] = [] // Create an array for the date if it doesn't exist
    }

    groups[date].push(proof) // Add the proof to the corresponding date group
    return groups
  }, {}) */

    const handleError = function (e: AppError): void {
      setIsLoading(false)
      setError(e)
    }


  const headerBg = useThemeColor('header')
    const iconColor = useThemeColor('textDim')
    const dateColor = useThemeColor('textDim')
    const iconSelectedColor = useThemeColor('button')
    const activeIconColor = useThemeColor('button')
    const hintColor = colors.palette.primary200


  return (
      <Screen style={$screen} preset="auto">
        <View style={[$headerContainer, {backgroundColor: headerBg}]}>
          <Text
            preset="heading"
            text="Recovery tool"
            style={{color: 'white'}}
          />
          <Text
            text="Select tokens to recover"
            preset="default"
            style={{color: hintColor}}
          />
        </View>
        <View style={$contentContainer}>
          <Card
            style={$actionCard}
            ContentComponent={
              <>
                <ListItem
                  text={'Pending only'}
                  LeftComponent={
                    <Icon
                      containerStyle={$iconContainer}
                      icon="faPaperPlane"
                      size={spacing.medium}
                      color={showPendingOnly ? activeIconColor : iconColor}
                    />
                  }
                  style={$item}
                  onPress={toggleShowPendingOnly}
                  bottomSeparator={true}
                />
                <ListItem
                  text={'Spent only'}
                  LeftComponent={
                    <Icon
                      containerStyle={$iconContainer}
                      icon="faBan"
                      size={spacing.medium}
                      color={showDeletedOnly ? activeIconColor : iconColor}
                    />
                  }
                  style={$item}
                  onPress={toggleShowDeletedOnly}
                />
              </>
            }
          />
          {(proofs && proofs.length) > 0 && (
            <Card
              ContentComponent={
                <>
                  {/*Object.entries(proofGroups).map(([date, proofs], index) => (
                    <View key={index}>
                    <ListItem
                        key={index}
                        text={date}
                        textStyle={{color: dateColor, textAlign: 'center'}}
                        bottomSeparator={true}
            />*/}
                  {proofs.map((proof: BackupProof, index: number) => {
                    const isSelected = selectedProofs.some(
                      p => p.secret === proof.secret,
                    )
                    return (
                      <ListItem
                        key={proof.secret}
                        text={`${proof.secret}`}
                        textStyle={$proofText}
                        subText={`${
                          proof.isPending
                            ? 'Pending'
                            : proof.isSpent
                            ? 'Spent'
                            : 'Received'
                        }`}
                        leftIcon={isSelected ? 'faCheckCircle' : 'faCircle'}
                        leftIconColor={
                          isSelected
                            ? (iconSelectedColor as string)
                            : (iconColor as string)
                        }
                        RightComponent={
                          <Text
                            text={`${proof.amount}`}
                            style={{
                              alignSelf: 'center',
                              marginHorizontal: spacing.medium,
                            }}
                          />
                        }
                        onPress={() => toggleSelectedProof(proof)}
                      />
                    )
                  })}
                </>
              }
              FooterComponent={
                <View style={{alignItems: 'center'}}>
                  {isAll ? (
                    <Text text="List is complete" size="xs" />
                  ) : (
                    <Button
                      preset="tertiary"
                      onPress={() =>
                        showPendingOnly
                          ? getMore(true, false)
                          : showDeletedOnly
                          ? getMore(false, true)
                          : getMore()
                      }
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
          {selectedProofs.length > 0 && (
            <Button
              preset="default"
              onPress={() => Alert.alert('Not implemented yet')}
              text="Recover selected"
              style={{marginVertical: spacing.medium, alignSelf: 'center'}}
            />
          )}
          {isLoading && <Loading />}
        </View>
        {error && <ErrorModal error={error} />}
        {info && <InfoModal message={info} />}
      </Screen>
    )
  }

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

const $cardHeading: TextStyle = {
  fontFamily: typography.primary?.medium,
  fontSize: 20,
}

const $iconContainer: ViewStyle = {
  padding: spacing.extraSmall,
  alignSelf: 'center',
  marginRight: spacing.medium,
}

const $item: ViewStyle = {
  marginHorizontal: spacing.micro,
}

const $proofText: TextStyle = {
  overflow: 'hidden',
  fontSize: 14,
}

const $txContainer: ViewStyle = {
  justifyContent: 'center',
  alignSelf: 'center',
  marginRight: spacing.extraSmall,
}

const $txAmount: TextStyle = {
  fontFamily: typography.primary?.medium,
  alignSelf: 'center',
  marginRight: spacing.small,
}

const $txIconContainer: ViewStyle = {
  padding: spacing.extraSmall,
  alignSelf: 'center',
  marginRight: spacing.medium,
}

const $bottomContainer: ViewStyle = {
  position: 'absolute',
  bottom: 0,
  left: 0,
  right: 0,
  flex: 1,
  justifyContent: 'flex-end',
  marginBottom: spacing.medium,
  alignSelf: 'stretch',
  // opacity: 0,
}

const $buttonReceive: ViewStyle = {
  borderTopLeftRadius: 30,
  borderBottomLeftRadius: 30,
  borderTopRightRadius: 0,
  borderBottomRightRadius: 0,
  minWidth: 130,
}
