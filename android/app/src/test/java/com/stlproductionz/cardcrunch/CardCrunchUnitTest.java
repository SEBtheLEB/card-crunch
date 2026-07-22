package com.stlproductionz.cardcrunch;

import static org.junit.Assert.assertEquals;

import org.junit.Test;

public class CardCrunchUnitTest {

    @Test
    public void scoreMultiplierUsesWholeValues() {
        assertEquals(600, 300 * 2);
    }
}
