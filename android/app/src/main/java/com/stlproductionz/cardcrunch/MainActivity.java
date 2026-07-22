package com.stlproductionz.cardcrunch;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        registerPlugin(GooglePlayGamesPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
