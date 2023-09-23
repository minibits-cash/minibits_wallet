import {observer} from 'mobx-react-lite'
import React, {FC, useState, useEffect, useRef, useMemo} from 'react'
import {
  ImageStyle,
  TextStyle,
  ViewStyle,
  View,
  ScrollView,
  Alert,
  useColorScheme,
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
import {BackupProof, Proof} from '../models/Proof'
import { useStores } from '../models'
import { getMintForToken, getProofsAmount } from '../services/cashuHelpers'
import JSONTree from 'react-native-json-tree'
import Clipboard from '@react-native-clipboard/clipboard'
import { getEncodedToken } from '@cashu/cashu-ts'

interface LocalRecoveryScreenProps
  extends SettingsStackScreenProps<'LocalRecovery'> {}

// Number of transactions held in TransactionsStore model
const limit = 10

export const LocalRecoveryScreen: FC<LocalRecoveryScreenProps> =
  function LocalRecoveryScreen(_props) {

  const { navigation } = _props
  const { mintsStore } = useStores()

  useHeader({
      leftIcon: 'faArrowLeft',
      onLeftPress: () => navigation.goBack(),
    })


    const [showUnspentOnly, setShowUnspentOnly] = useState<boolean>(true)
    const [showPendingOnly, setShowPendingOnly] = useState<boolean>(false)
    const [showSpentOnly, setShowSpentOnly] = useState<boolean>(false)
    const [proofs, setProofs] = useState<BackupProof[]>([])
    const [info, setInfo] = useState('')
    const [error, setError] = useState<AppError | undefined>()
    const [isLoading, setIsLoading] = useState(false)
    
    useEffect(() => {
      getProofsList(true, false, false)
      // Run on component unmount (cleanup)
      return () => {}
    }, [])

    const getProofsList = async function (
        isUnspent: boolean,
        isPending: boolean,
        isDeleted: boolean,
    ) {
      try {
            setIsLoading(true)
            const proofs = await Database.getProofs(isUnspent, isPending, isDeleted)
            setProofs(proofs)
            setIsLoading(false)
           
      } catch (e: any) {
        handleError(e)
      }
    }

    const toggleShowUnspentOnly = () =>
        setShowUnspentOnly(previousState => {
            if (!previousState) { // if on
                getProofsList(true, false, false)
                setShowSpentOnly(false)
                setShowPendingOnly(false)
            }

            return !previousState
    })
    
    const toggleShowPendingOnly = () =>
        setShowPendingOnly(previousState => {
            if (!previousState) { // if on
                getProofsList(false, true, false)
                setShowUnspentOnly(false)
                setShowSpentOnly(false)
            }
    
            return !previousState
    })

    const toggleShowSpentOnly = async () =>
        setShowSpentOnly(previousState => {
            if (!previousState) { // if on
                getProofsList(false, false, true)
                setShowUnspentOnly(false)
                setShowPendingOnly(false)
            }
    
            return !previousState
    })


    const copyBackupProofs = function (proofs: BackupProof[]) {
        try {               
            Clipboard.setString(JSON.stringify(proofs))  
        } catch (e: any) {
            setInfo(`Could not copy: ${e.message}`)
        }
    }


    const copyEncodedTokens = function (proofs: BackupProof[]) {
        try {
            const encodedTokens: string[] = []
            // TODO group by mints

            for (const proof of proofs) {
                const mint = getMintForToken(proof, mintsStore.allMints)
                const { tId, isPending, isSpent, updatedAt, ...cleanedProof } = proof

                if(mint) {
                    const encoded = getEncodedToken({
                        token: [
                            {
                                mint: mint.mintUrl,
                                proofs: [
                                    cleanedProof
                                ]
                            }
                        ]
                    })

                    encodedTokens.push(encoded)
                }
            }
            
            Clipboard.setString(JSON.stringify(encodedTokens))  
        } catch (e: any) {
            setInfo(`Could not copy: ${e.message}`)
        }
    }


    const handleError = function (e: AppError): void {
      setIsLoading(false)
      setError(e)
    }

    const colorScheme = useColorScheme()
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
        </View>
        <View style={$contentContainer}>
          <Card
            style={$actionCard}
            ContentComponent={
              <>
                <ListItem
                  text={'Unspent'}
                  LeftComponent={
                    <Icon
                      containerStyle={$iconContainer}
                      icon="faCoins"
                      size={spacing.medium}
                      color={showUnspentOnly ? activeIconColor : iconColor}
                    />
                  }
                  style={$item}
                  onPress={toggleShowUnspentOnly}
                  bottomSeparator={true}
                />
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
                  style={$item}
                  onPress={toggleShowPendingOnly}
                  bottomSeparator={true}
                />
                <ListItem
                  text={'Spent'}
                  LeftComponent={
                    <Icon
                      containerStyle={$iconContainer}
                      icon="faBan"
                      size={spacing.medium}
                      color={showSpentOnly ? activeIconColor : iconColor}
                    />
                  }
                  style={$item}
                  onPress={toggleShowSpentOnly}
                />
              </>
            }
          />
          {(proofs && proofs.length) > 0 && (
            <Card
              ContentComponent={
                <>
                <Text
                    style={{color: dateColor, fontSize: 14}}
                    text="Backed up proofs"
                />
                <JSONTree
                    hideRoot
                    data={proofs || []}
                    theme={{
                    scheme: 'default',
                    base00: '#eee',
                    }}
                    invertTheme={colorScheme === 'light' ? false : true}
                />                  
                </>
              }
              FooterComponent={
                <View style={$buttonContainer}>
                    <Button
                        preset="tertiary"
                        onPress={() => copyBackupProofs(proofs)}
                        text="Copy proofs"
                        style={{
                            minHeight: 25,
                            paddingVertical: spacing.extraSmall,
                            marginTop: spacing.small,
                            marginRight: spacing.small                           
                        }}
                        textStyle={{fontSize: 14}}
                    />
                    <Button
                        preset="tertiary"
                        onPress={() => copyEncodedTokens(proofs)}
                        text="Copy as encoded tokens"
                        style={{
                            minHeight: 25,
                            paddingVertical: spacing.extraSmall,
                            marginTop: spacing.small,                            
                        }}
                        textStyle={{fontSize: 14}}
                    />
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

const $buttonContainer: ViewStyle = {
    flexDirection: 'row',
    alignSelf: 'center',
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
