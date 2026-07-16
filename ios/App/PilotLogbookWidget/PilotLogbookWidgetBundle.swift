//
//  PilotLogbookWidgetBundle.swift
//  PilotLogbookWidget
//
//  Created by Benji Pearce on 2026-07-10.
//

import WidgetKit
import SwiftUI

@main
struct PilotLogbookWidgetBundle: WidgetBundle {
    var body: some Widget {
        StatsWidget()
        LogFlightWidget()
    }
}
