import * as React from 'react'
import { StyleSheet, View, ActivityIndicator, ViewProps } from 'react-native'
import { useThemeColor } from '../theme'
import { Text } from './Text'

export function Loading(props: ViewProps & {statusMessage?: string, opacity?: number}) {
    return (
        <View style={[{
            flex: 1,            
            alignItems: 'center',
            backgroundColor: useThemeColor('background'),
            opacity: props.opacity || 0.5,
            justifyContent: 'center',
            zIndex: 9999,
        }, StyleSheet.absoluteFillObject]}>
            <ActivityIndicator color="#ccc" animating size="large" />
            {props.statusMessage && (<Text style={{opacity: 1}} text={props.statusMessage}/>)}
        </View>
    )
}