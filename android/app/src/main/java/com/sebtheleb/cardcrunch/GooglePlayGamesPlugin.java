package com.sebtheleb.cardcrunch;

import android.content.Intent;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.google.android.gms.games.PlayGames;

@CapacitorPlugin(name = "GooglePlayGames")
public class GooglePlayGamesPlugin extends Plugin {
    private static final int LEADERBOARD_REQUEST_CODE = 9004;

    @PluginMethod
    public void signIn(PluginCall call) {
        getActivity().runOnUiThread(() -> PlayGames.getGamesSignInClient(getActivity())
            .isAuthenticated()
            .addOnCompleteListener(authenticationTask -> {
                if (authenticationTask.isSuccessful() && authenticationTask.getResult().isAuthenticated()) {
                    resolveAuthentication(call, true);
                    return;
                }
                PlayGames.getGamesSignInClient(getActivity())
                    .signIn()
                    .addOnCompleteListener(signInTask -> resolveAuthentication(
                        call,
                        signInTask.isSuccessful() && signInTask.getResult().isAuthenticated()
                    ));
            }));
    }

    @PluginMethod
    public void submitScore(PluginCall call) {
        Long score = call.getLong("score");
        String leaderboardId = getLeaderboardId();
        if (score == null || score < 0) {
            call.reject("A non-negative score is required.");
            return;
        }
        if (!isConfigured(leaderboardId)) {
            call.reject("Set leaderboard_best_run in res/values/strings.xml before publishing.");
            return;
        }
        getActivity().runOnUiThread(() -> {
            PlayGames.getLeaderboardsClient(getActivity()).submitScore(leaderboardId, score);
            call.resolve();
        });
    }

    @PluginMethod
    public void showLeaderboard(PluginCall call) {
        String leaderboardId = getLeaderboardId();
        if (!isConfigured(leaderboardId)) {
            call.reject("Set leaderboard_best_run in res/values/strings.xml before publishing.");
            return;
        }
        getActivity().runOnUiThread(() -> PlayGames.getLeaderboardsClient(getActivity())
            .getLeaderboardIntent(leaderboardId)
            .addOnSuccessListener(intent -> {
                getActivity().startActivityForResult(intent, LEADERBOARD_REQUEST_CODE);
                call.resolve();
            })
            .addOnFailureListener(error -> call.reject("Unable to open Play leaderboard.", error)));
    }

    private void resolveAuthentication(PluginCall call, boolean authenticated) {
        JSObject result = new JSObject();
        result.put("authenticated", authenticated);
        call.resolve(result);
    }

    private String getLeaderboardId() {
        return getContext().getString(R.string.leaderboard_best_run);
    }

    private boolean isConfigured(String value) {
        return value != null && !value.isEmpty() && !value.startsWith("REPLACE_");
    }
}
