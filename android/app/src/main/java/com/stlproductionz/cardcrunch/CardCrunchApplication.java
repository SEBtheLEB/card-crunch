package com.stlproductionz.cardcrunch;

import android.app.Application;
import com.google.android.gms.games.PlayGamesSdk;

public class CardCrunchApplication extends Application {
    @Override
    public void onCreate() {
        super.onCreate();
        PlayGamesSdk.initialize(this);
    }
}
