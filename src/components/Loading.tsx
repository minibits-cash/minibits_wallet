import * as React from 'react'
import { StyleSheet, View, ActivityIndicator, ViewProps } from 'react-native'
import { useThemeColor } from '../theme'

export function Loading(props: ViewProps) {
    return (
        <View style={[{
            flex: 1,            
            alignItems: 'center',
            backgroundColor: useThemeColor('background'),
            opacity: 0.5,
            justifyContent: 'center',
            zIndex: 9999,
        }, StyleSheet.absoluteFillObject]}>
            <ActivityIndicator color="#ccc" animating size="large" />
        </View>
    )
}