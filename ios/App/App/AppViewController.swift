import UIKit
import Capacitor

/// App-local Capacitor plugins register here (Main.storyboard instantiates
/// this subclass instead of CAPBridgeViewController directly).
class AppViewController: CAPBridgeViewController {
    override open func capacitorDidLoad() {
        bridge?.registerPluginInstance(ScanPlugin())
    }
}
